<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="features.md"><strong>Features</strong></a> ·
  <a href="onboarding.md"><strong>Setup</strong></a>
</p>

# SaaS, enterprise, privacy, and PCI readiness

> **Current status:** Lore is a comprehensive local prototype, not an externally approved multi-tenant SaaS service. Do not expose it to the internet or connect it to customer, production, regulated, or cardholder-data-environment repositories until the applicable gates in this document have named owners, evidence, and formal approval.

This document is an engineering and governance readiness plan, not legal advice, a PCI attestation, or a security certification. Before an external deployment, engage privacy counsel, the customer's security and data-protection teams, and a PCI Security Standards Council Qualified Security Assessor (QSA) where the service could access or affect a cardholder data environment (CDE).

## Why repository intelligence is sensitive

Lore may process much more than source code:

| Data class              | Examples                                                                                | Principal risk                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Source and architecture | PR patches, filenames, symbols, dependencies, configuration names                       | Intellectual property, vulnerability discovery, security design disclosure     |
| Work context            | PR/ticket descriptions, reviewer comments, incident references                          | Customer identifiers, support details, confidential roadmap, employee opinions |
| Identity                | GitHub usernames, reviewer activity, authorship and timestamps                          | Personal data, workplace monitoring, inaccurate profiling                      |
| Security data           | Secret-shaped strings, hostnames, log fragments, exploit details                        | Credential exposure and accelerated attack paths                               |
| Regulated data          | PAN, account data, health or other special-category data copied into a ticket or review | Regulatory scope, reportable breach, contractual violation                     |
| Derived knowledge       | Reviewer preferences, inferred rules, regressions, confidence and impact                | Incorrect authority, employee profiling, hidden bias, cross-tenant leakage     |
| Operations              | IP address, session/audit logs, support records, billing/contact data                   | Personal data and security telemetry exposure                                  |

The safe assumption is that pull requests and tickets can contain customer or production data even when policy says they should not. Controls therefore need to prevent, detect, quarantine, minimise, and delete—not merely tell users not to paste it.

## Deployment progression

Use the least centralised deployment that meets the actual need.

| Model                          | Source location                                   | Recommended status                         | Suitable use                                                                                                   |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Developer-local                | Developer machine                                 | Available now for non-sensitive evaluation | One user, selected repositories, local PAT, no public ingress                                                  |
| Customer-managed node          | Customer network/account                          | Target next                                | Source and evidence remain under customer control; central service receives only explicitly sanitised metadata |
| Dedicated single-tenant hosted | Isolated account/project per customer             | Only after P0 gates                        | Enterprise pilot with contractual controls and independent testing                                             |
| Multi-tenant SaaS              | Shared control plane with strong tenant isolation | Last                                       | Only after P0 and P1 gates, legal review, operational maturity, and customer approval                          |

The preferred enterprise architecture is a customer-managed Lore node that performs repository access, secret scanning, source analysis, and optional model calls inside the customer's trust boundary. A separate control plane should receive only the minimum approved graph, health, policy, and audit envelopes. Customers must be able to disable all source-derived content transfer.

## PCI DSS scope decision

PCI DSS v4.0.1 applies not only to entities that store, process, or transmit cardholder data (CHD) or sensitive authentication data (SAD), but also to service providers that **could impact the security of a CDE**. The [PCI SSC standard overview](https://www.pcisecuritystandards.org/standards/pci-dss/) states that scope includes entities that could affect CDE security, and [PCI SSC FAQ 1579](https://www.pcisecuritystandards.org/faqs/1579/) confirms this can apply even when the provider does not directly store, process, or transmit payment account data. PCI SSC says the people, processes, and technology involved in such a service may enter assessment scope; confirm the exact boundary with a QSA using [FAQ 1580](https://www.pcisecuritystandards.org/faqs/1580/) and the [PCI DSS v4.0.1 document library](https://www.pcisecuritystandards.org/document_library/).

### Initial decision tree

1. **Can Lore ingest CHD or SAD from source, diffs, tickets, comments, logs, attachments, or prompts?** If yes, stop ingestion, quarantine the object, notify the customer's authorised security contact, and perform a QSA-led scope and incident assessment. Do not send it to an AI provider.
2. **Can Lore or its operators access a CDE, credentials that reach it, deployment tooling, or security-relevant code/configuration?** If yes, treat Lore as potentially able to impact CDE security and obtain a written QSA determination before use.
3. **Does Lore supply a control used to meet a PCI requirement, block a deployment, or automatically change CDE-connected software?** If yes, the service may be a relevant third-party service provider. Require a responsibility matrix and assessor review.
4. **Is Lore segmented from the CDE and restricted to repositories formally classified as out of scope?** Record the data-flow and segmentation evidence, validate it at least annually and after significant change, and still run DLP because repositories drift.

Encryption does not automatically remove cardholder data from scope; [PCI SSC FAQ 1086](https://www.pcisecuritystandards.org/faqs/1086/) says encryption alone is insufficient. The product goal should be **do not ingest payment account data**, not “store it encrypted.”

### PCI-sensitive repository controls required before connection

- Customer security owner approves the repository and records its CDE relationship.
- Default to metadata-only import: PR number, title hash or approved summary, timestamps, paths, and non-sensitive graph edges.
- Run local pre-ingestion detection for PAN patterns with Luhn validation, track data, authentication data, secrets, private keys, connection strings, customer identifiers, and customer-defined patterns.
- Reject or quarantine before persistence; do not merely redact after the raw object has already reached central logs, queues, backups, or an AI API.
- Store quarantined data only in the customer node, encrypted with a customer-controlled key, under a short documented retention period and restricted incident role.
- Disable raw diffs, source snippets, review bodies, conversation comments, model calls, support access, and public webhook relays by default.
- Use customer-approved private connectivity and explicit egress allowlists.
- Produce a per-customer PCI responsibility matrix describing which controls Lore, the customer, cloud providers, and AI subprocessors own.
- Retain QSA scope decisions, segmentation tests, change reviews, vulnerability results, and incident exercises as evidence.

## Privacy and workplace-data obligations

PR authors, reviewers, commenters, ticket participants, and people mentioned in customer incidents are identifiable individuals. Their names, handles, activity, opinions, and inferred preferences may be personal data.

The UK GDPR distinguishes a controller, which decides why and how data is processed, from a processor acting on a controller's instructions. A SaaS provider is often a processor for customer repository data and a controller for its own account, security, and billing data, but roles depend on facts and can differ by processing activity. The ICO's [controller and processor guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/controllers-and-processors/controllers-and-processors/what-are-controllers-and-processors/) warns that a processor acting outside instructions may become a controller for that processing.

The design must implement the ICO's principles of purpose limitation, data minimisation, storage limitation, security, and demonstrable accountability, described in its [guide to data-protection principles](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/). The ICO says security measures must be appropriate to the processing risk and apply to controllers and processors in its [data-security guide](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/security/a-guide-to-data-security/).

Because Lore uses new technology to systematically infer engineering knowledge and reviewer tendencies across potentially large workforces, perform and approve a Data Protection Impact Assessment (DPIA) before an external pilot. The ICO requires a DPIA where processing is likely to result in high risk and highlights innovative technology, evaluation/scoring, sensitive data, and large-scale processing as risk factors in its [DPIA guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/when-do-we-need-to-do-a-dpia/).

### Privacy deliverables

- Record each processing purpose, data category, data subject, source, lawful basis, recipient, location, retention period, and deletion method.
- Document Lore's controller/processor role separately for customer content, product telemetry, account data, security logs, support copies, and model evaluation data.
- Sign an Article 28-compliant Data Processing Agreement (DPA) with processing instructions, confidentiality, security, subprocessors, rights assistance, breach assistance, deletion/return, and audit terms. The ICO lists the required processor contract terms in [its contract guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/what-needs-to-be-included-in-the-contract/).
- Publish a privacy notice and product-facing explanation of evidence, inference, confidence, human review, retention, and challenge/correction routes.
- Provide tenant-level export, correction, restriction, and verified deletion workflows that include primary data, queues, search indexes, model caches, logs, support copies, and backup expiry.
- Prevent Lore-derived reviewer profiles from becoming automated employment decisions. Require human review, allow challenge, show source evidence, and let customers disable profiling.
- Keep a current subprocessor register with purpose, data categories, region, and change-notification process.
- Identify every international transfer. The ICO says restricted transfers need adequacy, appropriate safeguards, or a valid exception and also require appropriate in-transit security; see its [international-transfer guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/a-guide-to-international-transfers/what-is-an-international-transfer-of-personal-information/).
- Recheck UK guidance before launch. ICO pages currently note updates following the Data (Use and Access) Act 2025, summarised by [GOV.UK](https://www.gov.uk/guidance/data-use-and-access-act-2025-data-protection-and-privacy-changes).

## EU AI Act and sector screening

If Lore is offered or used in the EU, document whether each feature makes Lore a provider, deployer, importer, distributor, or downstream provider under the EU AI Act and classify the intended purpose with counsel. The [official Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj?locale=en) identifies employment, worker-management, task allocation based on individual behaviour/traits, and worker monitoring or evaluation as potentially high-risk use cases. A customer turning reviewer profiles into performance, promotion, retention, or task-allocation decisions could therefore materially change Lore's classification and obligations.

Lore must prohibit employment decisions and employee scoring in product terms and technical defaults unless a separately assessed, compliant use case is deliberately built. Human review alone is not a blanket exemption, and an AI system performing profiling in an Annex III use case can remain high-risk. Maintain intended-purpose documentation, foreseeable-misuse analysis, user instructions, logs, human-oversight design, monitoring, incident handling, and change control. The European Commission's [Article 50 transparency guidance](https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems) says relevant transparency duties apply from 2 August 2026; verify the current implementation timeline and classification guidance immediately before launch because EU rules and guidance continue to evolve.

Run a jurisdiction and sector assessment for every target market and customer. This should cover, as applicable, EU/UK data protection, the EU AI Act, employment/works-council consultation, confidentiality and trade-secret duties, export/sanctions controls, breach-notification rules, financial/health/public-sector requirements, and critical-infrastructure/cybersecurity regimes. For example, ENISA's [NIS2 implementation material](https://www.enisa.europa.eu/news/supporting-nis2-implementation-through-actionable-guidance) addresses cloud and managed service providers, but whether Lore or a customer is in scope depends on the service and national implementation. Record the legal determination; do not infer compliance from a generic control checklist.

## Mandatory product and architecture gates

### Implemented local account foundation

Lore now has GitHub-only human login with state and PKCE, verified-email/stable-ID linking, editable GitHub-seeded profiles, opaque hashed and revocable server sessions, expiry and rotation, personal accounts spanning private organisations, owner/admin/member/viewer roles, live membership checks, and verified-email invitations. These controls materially improve the local product and remove the former identity-bearing cookie design.

They do not close the external-deployment gate. GitHub OAuth is not enterprise OIDC/SAML, the four baseline roles are not the final security/knowledge/auditor/support role model, and the service still needs the isolation, lifecycle, operational, legal, assurance, and regulated-data controls below. See [Authentication and organisations](authentication-and-organisations.md) for the implemented boundary.

### P0 — required before any external pilot

- [ ] Production identity provider with OIDC/SAML SSO, MFA enforcement, invite/domain controls, short-lived sessions, revocation, and no `LOCAL_DEV_AUTH`.
- [ ] Server-side opaque sessions; rotate and revoke individual sessions. Do not use an indefinitely reusable self-contained browser identity.
- [ ] Tenant-scoped RBAC for owner, security administrator, knowledge reviewer, developer, auditor, and support roles; deny by default.
- [ ] GitHub App installation ownership verified through the authenticated GitHub user/organisation before binding to a Lore tenant. Never trust `installation_id` from the setup redirect alone.
- [ ] Dedicated source-connection records with encrypted credential references, rotation/revocation status, installation/repository allowlists, and audit history.
- [ ] Managed secret vault/KMS; no production secrets in `.env`, images, database rows, logs, support exports, or queue payloads.
- [ ] TLS everywhere, secure headers, private database/Redis networks, authentication on Redis, least-privilege database identities, egress allowlists, and restricted administration plane.
- [ ] Tenant-isolation tests for every store method and job; composite tenant keys and foreign keys where possible; database row-level security as defence in depth.
- [ ] Per-tenant encryption-key hierarchy or cryptographic isolation with documented rotation and destruction.
- [ ] Durable transactional outbox or equivalent atomic dispatch, dead-letter handling, checkpointed GitHub import, retry budgets, per-tenant quotas, and visible cancellation.
- [ ] Pre-persistence secret/PII/PCI scanning and quarantine at the customer node; configurable deny patterns and false-positive review.
- [ ] Customer-controlled retention defaults before first import; verified repository, tenant, and data-subject deletion.
- [ ] Immutable or tamper-evident security/audit export with actor, tenant, source, purpose, before/after, request ID, IP/device context, and time synchronisation.
- [ ] Backup encryption, restore test, regional location record, recovery time/recovery point objectives, and deletion propagation policy.
- [ ] Independent penetration test covering tenant isolation, auth, GitHub installation takeover, webhook replay, SSRF, injection, object-level authorisation, and support access.
- [ ] Vulnerability management with dependency/container scanning, SBOM, signed build provenance, patch SLAs, coordinated disclosure, and emergency revocation.
- [ ] Incident response plan with customer notification decision tree, forensics/log preservation, regulator/card-brand/QSA escalation, and tested tabletop.
- [ ] Approved DPA, privacy notice, terms, acceptable-use policy, subprocessor list, DPIA, data-flow diagrams, retention schedule, and customer security schedule.

### P1 — required before multi-tenant general availability

- [ ] Automated SCIM lifecycle and group/role mapping; periodic access reviews and break-glass controls.
- [ ] Control-plane/customer-node mutual authentication, device identity, scoped short-lived tokens, signed updates, remote revocation, and outbound-only connection option.
- [ ] Tenant-specific regions and data-residency enforcement across database, object store, logs, backups, analytics, support, and AI providers.
- [ ] Workload isolation and noisy-neighbour controls; per-tenant queues, rate limits, cost budgets, concurrency, storage quotas, and abuse detection.
- [ ] Continuous control monitoring, central alerting, on-call ownership, security metrics, restore exercises, disaster-recovery exercise, and status communication.
- [ ] Formal secure-development baseline mapped to the final [NIST SSDF 1.1](https://csrc.nist.gov/Projects/ssdf/publications) and a pinned [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) version. Treat newer drafts separately until final.
- [ ] External assurance selected from customer need and scope, commonly SOC 2 Type II and/or ISO/IEC 27001; never advertise certification before the report/certificate exists and covers the service.
- [ ] Enterprise evidence pack: architecture, threat model, data flow, security whitepaper, latest penetration summary, continuity results, subprocessor list, privacy materials, SBOM process, and standard questionnaire answers.
- [ ] Support-access workflow with customer approval, time-bound elevation, session recording/audit, data minimisation, and emergency-access review.
- [ ] Security and privacy change review for new data sources, AI models, subprocessors, regions, retention uses, or autonomous actions.

## AI-specific governance

AI is optional in Lore and must remain subordinate to deterministic analysis and human authority. The [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework) is a voluntary framework for governing, mapping, measuring, and managing AI risk; its [Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) adds cross-sector guidance for generative AI.

Before enabling a hosted model for customer data:

- Obtain explicit tenant opt-in for the exact provider, model, region, purposes, and data categories.
- Contractually prohibit training or provider product improvement with customer content; document provider retention and abuse-monitoring exceptions.
- Prefer zero-retention/private endpoints and customer-managed model credentials where available.
- Apply local classification, minimisation, secret/PCI/PII redaction, and token budgets before transmission.
- Never transmit quarantined content, raw credentials, CHD/SAD, full repositories, or unrelated ticket history.
- Treat source, tickets, comments, model output, retrieved documents, and tool-like text as untrusted. Models cannot execute tools, create policy, assign enforcement authority, or write active knowledge directly.
- Version prompts/schemas/models, validate structured output, retain evaluation provenance, and support deterministic rollback.
- Maintain representative privacy, security, prompt-injection, hallucination, cross-tenant, bias, and regression evaluations with release thresholds.
- Give people meaningful explanations and correction/challenge paths for inferred reviewer preferences; do not use them for employment decisions.
- Record model incidents and material limitations. Human approval must remain an actual control, not a rubber stamp hidden behind defaults.

## Required organisational policies

Technology controls need approved owners, training, evidence, review intervals, and enforcement. At minimum maintain:

1. Information security and enterprise risk management.
2. Data classification and handling, including source, secrets, personal data, CHD/SAD, and customer data.
3. Privacy, records of processing, data-subject rights, privacy by design, and DPIA procedure.
4. Access control, joiner/mover/leaver, privileged access, support access, and periodic review.
5. Cryptography, key management, secret management, and credential rotation.
6. Secure SDLC, threat modelling, code review, testing, release approval, and change management.
7. Vulnerability, dependency, container, infrastructure, penetration-test, disclosure, and patch management.
8. Logging, monitoring, alerting, time synchronisation, audit retention, and acceptable monitoring.
9. Incident response, personal-data breach response, PCI escalation, communications, evidence handling, and post-incident review.
10. Backup, restoration, business continuity, disaster recovery, and resilience testing.
11. Supplier/subprocessor due diligence, contracts, reassessment, concentration risk, and exit.
12. Retention, legal hold, export, deletion, backup expiry, and media disposal.
13. Network, cloud, endpoint, remote-work, and environment-separation security.
14. AI acceptable use, provider approval, model/data inventory, evaluation, human oversight, incident handling, and prohibited use.
15. Personnel security, confidentiality, security/privacy training, and sanctions.

## Customer onboarding decision record

Do not accept a repository until the customer and Lore owner record:

- business purpose and approved users;
- owner, repository, branches, and GitHub App installation;
- source/work-item data classification and prohibited data;
- CDE connection or ability to affect CDE security, with QSA decision when relevant;
- Lore's controller/processor role, lawful basis, data subjects, DPIA outcome, and DPA;
- data region, subprocessors, transfers, AI provider/model choice, and AI opt-in;
- retention for PR bodies, reviews/comments, raw diffs, derived knowledge, audit, support, and backup;
- DLP rules, quarantine owner, notification path, and incident contacts;
- SSO/SCIM groups, RBAC, support-access approval, export/deletion authority;
- pilot success measures, monitoring, exit/export/deletion test, and renewal review date.

## Delivery roadmap and evidence

| Phase                     | Exit evidence                                                                                                  | Approval                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 0. Local evaluation       | Selected-repo PAT, setup check, no public ingress, retention configured, token revoked at end                  | Repository owner                  |
| 1. Threat and data design | Data-flow diagrams, asset/data inventory, threat model, PCI screening, DPIA screening, deployment choice       | Security and privacy leads        |
| 2. Customer-managed node  | Node/control-plane protocol, DLP/quarantine, egress policy, device credentials, deletion proof, signed updates | Customer security architecture    |
| 3. Single-tenant pilot    | P0 gates, contracts, independent pen test, incident/restore exercise, QSA decision if relevant                 | Executive risk owner and customer |
| 4. Multi-tenant beta      | Tenant-isolation evidence, P1 technical controls, regional processing map, on-call/SLOs, questionnaire pack    | Security, privacy, operations     |
| 5. General availability   | Sustained control evidence, selected assurance report, customer offboarding proof, governance review           | Formal go-live authority          |

Every checkbox needs an owner, due date, implementation link, test/evidence link, exceptions, compensating controls, expiry, and approver. “Planned” is not evidence.

## Immediate no-go conditions

Do not deploy externally if any of these are true:

- production relies on `LOCAL_DEV_AUTH`, demo identities, shared credentials, or an unverified installation ID;
- the browser, database, job payload, log, support ticket, analytics product, or source repository contains a GitHub token/private key;
- customer content can reach an AI provider without tenant opt-in, DPA/subprocessor review, classification, and retention controls;
- Lore can access or affect a CDE without a documented QSA-supported scope decision;
- raw source/comments are centrally stored by default or deletion cannot be demonstrated through backups and derived stores;
- tenant isolation is enforced only in UI/API conventions without store/job tests and database defence in depth;
- security incident, privacy breach, restore, and customer-notification processes have not been exercised;
- marketing claims certification, PCI compliance, zero retention, data residency, or “no training” without current contractual and technical evidence.
