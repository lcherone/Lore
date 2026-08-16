import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  Database,
  ExternalLink,
  FileCode2,
  Filter,
  GitBranch,
  History,
  LoaderCircle,
  Link2,
  ListFilter,
  MessageSquareText,
  Mic,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  UserRoundCheck
} from "lucide-react";
import type {
  CandidateRecord,
  CodeEntity,
  CodeGraphPage,
  CodeRelationshipView,
  CommunicationEvidenceAnalysis,
  CommunicationEvidenceInput,
  CommunicationSourceType,
  ContextPackage,
  DashboardSnapshot,
  EvidenceRecord,
  JobRunRecord,
  KnowledgeItem,
  KnowledgeKind,
  KnowledgeScope,
  PolicyRecord,
  PullRequestImportLimit,
  RepositoryRetentionConfig,
  RepositorySummary,
  SafetyReport,
  SettingsBundle
} from "@lore/shared/types.js";
import {
  Button,
  Confidence,
  EmptyState,
  FormField,
  KindIcon,
  Modal,
  PageHeader,
  Risk,
  SeverityLabel
} from "./components.js";
import { parseGitHubRepositoryReference } from "./github-repository.js";
import {
  loreApi,
  type GitHubRepositoryOption,
  type RepositoryBatchConnectionResult
} from "./api.js";

const MAX_REPOSITORIES_PER_BATCH = 500;
const CODE_ENTITY_TYPES: CodeEntity["type"][] = [
  "file", "class", "interface", "trait", "function", "method", "constant", "event",
  "listener", "service", "repository", "controller", "route", "database_table",
  "configuration_key", "external_api", "test"
];

function RepositoryGraphModal({
  repository,
  onClose
}: {
  repository: RepositorySummary;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"entities" | "relationships">("entities");
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState<CodeEntity["type"] | "all">("all");
  const [page, setPage] = useState(1);
  const [entities, setEntities] = useState<CodeGraphPage<CodeEntity>>();
  const [relationships, setRelationships] = useState<CodeGraphPage<CodeRelationshipView>>();
  const [focusedEntity, setFocusedEntity] = useState<CodeEntity>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    const timer = window.setTimeout(() => {
      const request = tab === "entities"
        ? loreApi.repositoryEntities(repository.id, {
            search: search.trim() || undefined,
            type: entityType === "all" ? undefined : entityType,
            page,
            pageSize: 50
          }).then((result) => { if (active) setEntities(result); })
        : loreApi.repositoryRelationships(repository.id, {
            search: search.trim() || undefined,
            entityId: focusedEntity?.id,
            page,
            pageSize: 50
          }).then((result) => { if (active) setRelationships(result); });
      void request.catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Code graph could not be loaded");
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [entityType, focusedEntity?.id, page, repository.id, search, tab]);

  const changeTab = (next: "entities" | "relationships"): void => {
    setTab(next);
    setPage(1);
    setSearch("");
    if (next === "entities") setFocusedEntity(undefined);
  };
  const inspectRelationships = (entity: CodeEntity): void => {
    setFocusedEntity(entity);
    setTab("relationships");
    setSearch("");
    setPage(1);
  };
  const result = tab === "entities" ? entities : relationships;
  const first = result?.total ? (result.page - 1) * result.pageSize + 1 : 0;
  const last = result ? (result.page - 1) * result.pageSize + result.count : 0;

  return (
    <Modal
      title={`${repository.owner}/${repository.name} code graph`}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="modal-note">
            {result ? `${first.toLocaleString()}–${last.toLocaleString()} of ${result.total.toLocaleString()}` : "Loading graph…"}
          </span>
          <Button variant="secondary" disabled={!result || result.page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button>
          <Button variant="secondary" disabled={!result?.hasMore || loading} onClick={() => setPage((value) => value + 1)}>Next</Button>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="graph-browser">
        <div className="graph-browser__summary">
          <div><Braces size={18} /><span><strong>{repository.entityCount.toLocaleString()}</strong> entities</span></div>
          <div><Link2 size={18} /><span><strong>{repository.relationshipCount.toLocaleString()}</strong> relationships</span></div>
          <small>Indexed at {repository.lastIndexedCommit?.slice(0, 10) ?? "unknown commit"}</small>
        </div>
        <div className="graph-browser__tabs" role="tablist" aria-label="Code graph data">
          <button className={tab === "entities" ? "is-active" : ""} role="tab" aria-selected={tab === "entities"} onClick={() => changeTab("entities")}>Entities</button>
          <button className={tab === "relationships" ? "is-active" : ""} role="tab" aria-selected={tab === "relationships"} onClick={() => changeTab("relationships")}>Relationships</button>
        </div>
        <div className="graph-browser__toolbar">
          <label>
            <Search size={15} />
            <input
              aria-label={`Search ${tab}`}
              placeholder={tab === "entities" ? "Search name, symbol, or path…" : "Search relationship, source, or target…"}
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            />
          </label>
          {tab === "entities" && (
            <select aria-label="Entity type" value={entityType} onChange={(event) => { setEntityType(event.target.value as CodeEntity["type"] | "all"); setPage(1); }}>
              <option value="all">All entity types</option>
              {CODE_ENTITY_TYPES.map((type) => <option value={type} key={type}>{type.replaceAll("_", " ")}</option>)}
            </select>
          )}
          {tab === "relationships" && focusedEntity && (
            <button className="graph-browser__focus" onClick={() => { setFocusedEntity(undefined); setPage(1); }}>
              Related to {focusedEntity.name} <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
        {error ? <div className="form-error">{error}</div> : loading && !result ? <div className="loading-line" /> : null}
        {tab === "entities" && entities && (
          <div className="graph-list graph-list--entities">
            {entities.items.map((entity) => (
              <button key={entity.id} onClick={() => inspectRelationships(entity)}>
                <span className="graph-kind">{entity.type.replaceAll("_", " ")}</span>
                <span><strong>{entity.qualifiedName}</strong><small>{entity.path}{entity.startLine ? `:${entity.startLine}` : ""} · {entity.language}</small></span>
                <span>View links <ChevronRight size={15} /></span>
              </button>
            ))}
            {!loading && entities.items.length === 0 && <EmptyState title="No entities found" body="Try a different name, path, symbol, or entity type." />}
          </div>
        )}
        {tab === "relationships" && relationships && (
          <div className="graph-list graph-list--relationships">
            {relationships.items.map((relationship) => (
              <article key={relationship.id}>
                <span><strong>{relationship.sourceEntity.qualifiedName}</strong><small>{relationship.sourceEntity.path}</small></span>
                <span className="graph-link-type"><ArrowRight size={15} /><em>{relationship.relationshipType.replaceAll("_", " ")}</em></span>
                <span><strong>{relationship.targetEntity.qualifiedName}</strong><small>{relationship.targetEntity.path}</small></span>
                <small>{Math.round(relationship.confidence * 100)}% · {relationship.source.replaceAll("_", " ")}</small>
              </article>
            ))}
            {!loading && relationships.items.length === 0 && <EmptyState title="No relationships found" body="Try a different source, target, relationship type, or entity." />}
          </div>
        )}
      </div>
    </Modal>
  );
}

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(value)
  );

const relativeTime = (value: string): string => {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

const communicationExample = `Alex: We agreed that refund tax changes must include RefundTaxTransactionTest.
Sam: The checkout team prefers repository interfaces at application service boundaries.
Priya: Remember: never log full external API payloads because they may contain customer data.
Alex: Yesterday I finished the release notes and today I am reviewing the deployment.`;

const dispositionLabel = (value: CommunicationEvidenceAnalysis["candidates"][number]["disposition"]): string =>
  ({
    new: "New suggestion",
    already_added: "Already added",
    supports_existing: "Supports existing",
    conflicts: "Possible conflict"
  })[value];

const communicationSourceLabel = (evidence: EvidenceRecord): string => {
  const sourceType = evidence.metadata.sourceType;
  return typeof sourceType === "string" ? sourceType.replace("_", " ") : "communication";
};

export function EvidencePage({
  repositories,
  onAnalyse,
  onList,
  onReview
}: {
  repositories: RepositorySummary[];
  onAnalyse: (input: CommunicationEvidenceInput) => Promise<CommunicationEvidenceAnalysis>;
  onList: () => Promise<EvidenceRecord[]>;
  onReview: () => void;
}) {
  const [form, setForm] = useState({
    sourceType: "standup" as CommunicationSourceType,
    repositoryId: "",
    title: "",
    content: "",
    participants: "",
    occurredAt: "",
    sourceReference: "",
    sourceUrl: "",
    authorityConfirmed: false
  });
  const [result, setResult] = useState<CommunicationEvidenceAnalysis>();
  const [recent, setRecent] = useState<EvidenceRecord[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void onList()
      .then((items) => active && setRecent(items))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [onList]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!form.authorityConfirmed) {
      setError("Confirm that you are allowed to retain this communication before continuing.");
      return;
    }
    setWorking(true);
    setError(undefined);
    try {
      const analysis = await onAnalyse({
        sourceType: form.sourceType,
        title: form.title,
        content: form.content,
        authorityConfirmed: true,
        ...(form.repositoryId ? { repositoryId: form.repositoryId } : {}),
        ...(form.participants.trim()
          ? { participants: form.participants.split(",").map((item) => item.trim()).filter(Boolean) }
          : {}),
        ...(form.occurredAt ? { occurredAt: new Date(form.occurredAt).toISOString() } : {}),
        ...(form.sourceReference ? { sourceReference: form.sourceReference } : {}),
        ...(form.sourceUrl ? { sourceUrl: form.sourceUrl } : {})
      });
      setResult(analysis);
      setRecent((items) => [analysis.evidence, ...items.filter((item) => item.id !== analysis.evidence.id)]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lore could not analyse this communication");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="page-pad evidence-page">
      <PageHeader
        title="Add communication evidence"
        description="Turn a Slack note, call, meeting, or full standup transcript into evidence-backed suggestions."
        actions={
          <Button variant="secondary" icon={<Mic size={15} />} onClick={() => setForm((value) => ({ ...value, title: "Example engineering standup", content: communicationExample, sourceType: "standup" }))}>
            Use example transcript
          </Button>
        }
      />

      <div className="evidence-safety" role="note">
        <ShieldCheck size={19} />
        <span>
          <strong>Private by design in this local demo.</strong> Lore stores the original text for provenance, treats it as untrusted input, and never activates extracted knowledge without human review. Remove secrets, payment data, and unnecessary customer information before pasting.
        </span>
      </div>

      <div className="evidence-layout">
        <section className="evidence-compose">
          <header>
            <MessageSquareText size={19} />
            <div>
              <h2>Paste a note or transcript</h2>
              <p>Keep speaker names and context. Lore ignores ordinary status updates unless they contain an explicit decision, rule, preference, fact, warning, or regression signal.</p>
            </div>
          </header>
          <form className="form-stack" onSubmit={(event) => void submit(event)}>
            <div className="form-grid">
              <FormField label="Communication type">
                <select value={form.sourceType} onChange={(event) => setForm((value) => ({ ...value, sourceType: event.target.value as CommunicationSourceType }))}>
                  <option value="standup">Standup transcript</option>
                  <option value="slack">Slack or chat</option>
                  <option value="meeting">Meeting</option>
                  <option value="call">Call</option>
                  <option value="in_person">In person</option>
                  <option value="email">Email</option>
                  <option value="note">Personal note</option>
                  <option value="other">Other</option>
                </select>
              </FormField>
              <FormField label="Repository" hint="Optional; leave blank for organisation-wide evidence">
                <select value={form.repositoryId} onChange={(event) => setForm((value) => ({ ...value, repositoryId: event.target.value }))}>
                  <option value="">Organisation-wide</option>
                  {repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.owner}/{repository.name}</option>)}
                </select>
              </FormField>
            </div>
            <FormField label="Title">
              <input required minLength={3} maxLength={200} placeholder="Payments standup · 16 August" value={form.title} onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))} />
            </FormField>
            <FormField label="Communication text" hint={`${form.content.length.toLocaleString()} / 500,000 characters`}>
              <textarea className="evidence-transcript" required minLength={8} maxLength={500_000} placeholder="Paste one message, meeting notes, or the complete transcript…" value={form.content} onChange={(event) => setForm((value) => ({ ...value, content: event.target.value }))} />
            </FormField>
            <div className="form-grid">
              <FormField label="Participants" hint="Optional; comma separated">
                <input placeholder="Alex, Sam, Priya" value={form.participants} onChange={(event) => setForm((value) => ({ ...value, participants: event.target.value }))} />
              </FormField>
              <FormField label="When it happened" hint="Optional">
                <input type="datetime-local" value={form.occurredAt} onChange={(event) => setForm((value) => ({ ...value, occurredAt: event.target.value }))} />
              </FormField>
            </div>
            <div className="form-grid">
              <FormField label="Source reference" hint="Optional channel, meeting ID, or location">
                <input placeholder="#payments-eng" value={form.sourceReference} onChange={(event) => setForm((value) => ({ ...value, sourceReference: event.target.value }))} />
              </FormField>
              <FormField label="Source URL" hint="Optional; access controls still apply">
                <input type="url" placeholder="https://…" value={form.sourceUrl} onChange={(event) => setForm((value) => ({ ...value, sourceUrl: event.target.value }))} />
              </FormField>
            </div>
            <label className="evidence-consent">
              <input type="checkbox" required checked={form.authorityConfirmed} onChange={(event) => setForm((value) => ({ ...value, authorityConfirmed: event.target.checked }))} />
              <span>I am allowed to add this communication and have removed secrets, payment data, and unnecessary customer data.</span>
            </label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="evidence-submit">
              <span>Suggestions go to Candidates. Nothing is approved automatically.</span>
              <Button type="submit" variant="primary" icon={<Sparkles size={15} />} disabled={working || !form.authorityConfirmed || !form.title.trim() || !form.content.trim()}>
                {working ? "Analysing…" : "Save and analyse evidence"}
              </Button>
            </div>
          </form>
        </section>

        <aside className="evidence-aside">
          <section>
            <h2>What Lore looks for</h2>
            <ol>
              <li><strong>Explicit decisions</strong><span>“We agreed…” or “Decision:”</span></li>
              <li><strong>Rules and cautions</strong><span>“Must”, “never”, “do not”, risks, and regressions</span></li>
              <li><strong>Team preferences</strong><span>“Prefer” and “should”, kept advisory</span></li>
              <li><strong>Existing context</strong><span>Duplicates, supporting evidence, and possible conflicts</span></li>
            </ol>
          </section>
          <section>
            <h2>Recent communications</h2>
            <div className="recent-evidence">
              {recent.slice(0, 5).map((item) => (
                <article key={item.id}>
                  <MessageSquareText size={15} />
                  <span><strong>{item.title}</strong><small>{communicationSourceLabel(item)} · {relativeTime(item.occurredAt)}</small></span>
                </article>
              ))}
              {!recent.length && <p>No communication evidence has been added yet.</p>}
            </div>
          </section>
        </aside>
      </div>

      {result && (
        <section className="evidence-results" aria-live="polite">
          <header>
            <div>
              <span className="eyebrow">Analysis complete</span>
              <h2>{result.candidates.length ? `${result.candidates.length} review candidate${result.candidates.length === 1 ? "" : "s"}` : "Evidence saved — no actionable signals found"}</h2>
              <p>{result.evidenceAdded ? "A new evidence record was retained." : "This exact evidence was already retained, so Lore reused it."}</p>
            </div>
            {result.candidates.length > 0 && <Button variant="primary" icon={<ArrowRight size={15} />} onClick={onReview}>Review candidates</Button>}
          </header>
          <div className="evidence-counts">
            {(["new", "already_added", "supports_existing", "conflicts"] as const).map((key) => <div key={key} className={`evidence-count evidence-count--${key}`}><strong>{result.counts[key]}</strong><span>{dispositionLabel(key)}</span></div>)}
          </div>
          <div className="evidence-suggestions">
            {result.candidates.map((item) => (
              <article key={item.candidate.id}>
                <span className={`comparison-badge comparison-badge--${item.disposition}`}>{dispositionLabel(item.disposition)}</span>
                <KindIcon kind={item.candidate.kind} />
                <div>
                  <h3>{item.candidate.title}</h3>
                  <p>{item.candidate.statement}</p>
                  <small>{item.explanation}</small>
                  {item.matches.length > 0 && <em>Matched: {item.matches.map((match) => match.title).join(", ")}</em>}
                </div>
                <Confidence value={item.candidate.confidence} />
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function DashboardPage({
  data,
  onPrepare,
  onNavigate
}: {
  data: DashboardSnapshot;
  onPrepare: (task: string, repositoryId: string) => Promise<ContextPackage>;
  onNavigate: (page: string) => void;
}) {
  const [task, setTask] = useState("SS-6160 Update Avalara ShipFrom and ShipTo addresses");
  const [repositoryId, setRepositoryId] = useState(data.repositories[0]?.id ?? "");
  const [context, setContext] = useState<ContextPackage>();
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string>();
  const active = data.knowledge.filter((item) => item.status === "active").length;
  const challenged = data.knowledge.filter((item) => item.status === "challenged").length;
  const stale = data.knowledge.filter((item) => item.health === "stale").length;

  const prepare = async (): Promise<void> => {
    if (!task.trim() || !repositoryId) return;
    setPreparing(true);
    setError(undefined);
    try {
      setContext(await onPrepare(task, repositoryId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lore could not prepare this task");
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="dashboard-layout">
      <main className="dashboard-main">
        <header className="dashboard-intro">
          <h1>Your engineering memory, ready.</h1>
          <p>
            Prepare a task with the decisions, risks, and evidence your agent needs before it
            touches code.
          </p>
        </header>

        <section className="prepare-box" aria-label="Prepare task context">
          <textarea
            id="lore-task"
            name="task"
            value={task}
            onChange={(event) => setTask(event.target.value)}
            aria-label="Task description"
          />
          <div className="prepare-box__footer">
            <label>
              <span>Repository</span>
              <select
                id="lore-repository"
                name="repositoryId"
                value={repositoryId}
                onChange={(event) => setRepositoryId(event.target.value)}
              >
                {data.repositories.map((repository) => (
                  <option value={repository.id} key={repository.id}>
                    {repository.owner}/{repository.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="primary"
              onClick={() => void prepare()}
              disabled={preparing || !task.trim()}
            >
              {preparing ? "Preparing…" : "Prepare context"}
              <ArrowRight size={17} />
            </Button>
          </div>
          {error && <p className="inline-error">{error}</p>}
        </section>

        <div className="dashboard-split">
          <section className="open-panel knowledge-pulse">
            <div className="panel-heading">
              <h2>
                Knowledge pulse <CircleHelp size={14} />
              </h2>
              <span>
                Overall health <strong>Healthy</strong>
              </span>
            </div>
            <div className="health-line">
              <span className="health-line__healthy" />
              <span className="health-line__candidate" />
              <span className="health-line__challenged" />
              <span className="health-line__stale" />
            </div>
            {[
              ["Active", active, "Trusted and enforced knowledge", "healthy"],
              ["Candidates", data.candidates.length, "Awaiting reviewer decision", "candidate"],
              ["Challenged", challenged, "Disputed or needs updates", "challenged"],
              ["Stale", stale, "Outdated or not confirmed", "stale"]
            ].map(([label, count, description, tone]) => (
              <button
                className="metric-row"
                key={String(label)}
                onClick={() => onNavigate(label === "Candidates" ? "candidates" : "knowledge")}
              >
                <span className={`metric-dot metric-dot--${tone}`} />
                <span>{label}</span>
                <strong>{count}</strong>
                <small>{description}</small>
                <ChevronRight size={16} />
              </button>
            ))}
          </section>

          <section className="open-panel attention-panel">
            <div className="panel-heading">
              <h2>Needs your attention</h2>
            </div>
            <div className="attention-list">
              {data.candidates.slice(0, 3).map((candidate) => (
                <button key={candidate.id} onClick={() => onNavigate("candidates")}>
                  <KindIcon kind={candidate.kind} />
                  <span>
                    <strong>{candidate.title}</strong>
                    <small>
                      {candidate.scope.repository ?? "Organisation"} ·{" "}
                      {candidate.evidenceIds.length} pieces of evidence
                      <br />
                      {relativeTime(candidate.updatedAt)}
                    </small>
                  </span>
                  <SeverityLabel severity={candidate.severity} />
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
            <button className="text-link" onClick={() => onNavigate("candidates")}>
              View all candidates <ArrowRight size={15} />
            </button>
          </section>
        </div>

        <section className="reports-table open-panel">
          <div className="panel-heading">
            <h2>Recent safety reports</h2>
          </div>
          <div className="data-table data-table--reports">
            <div className="data-table__header">
              <span>Report</span>
              <span>Repository</span>
              <span>Evidence</span>
              <span>Time</span>
              <span>Risk status</span>
              <span />
            </div>
            {data.reports.slice(0, 4).map((report) => (
              <button
                className="data-table__row"
                key={report.id}
                onClick={() => onNavigate("reports")}
              >
                <span className="table-primary">
                  <FileCode2 size={17} />
                  <span>
                    <strong>{report.task.replace(/^\S+\s/, "")}</strong>
                    <small>
                      {report.changedFiles.length} changed files · {report.changedSymbols.length}{" "}
                      symbols
                    </small>
                  </span>
                </span>
                <span>{report.repositoryName}</span>
                <span>{report.evidenceCount}</span>
                <span>{relativeTime(report.createdAt)}</span>
                <span>
                  <Risk level={report.risk} />
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
          <button className="text-link" onClick={() => onNavigate("reports")}>
            View all safety reports <ArrowRight size={15} />
          </button>
        </section>
      </main>

      <aside className="how-lore-works">
        <h2>How Lore works</h2>
        {[
          [Database, "Observe evidence", "Ingest code, docs, tests, PRs, and run outputs."],
          [
            Sparkles,
            "Propose knowledge",
            "Synthesize decisions, patterns, and risks with provenance."
          ],
          [
            UserRoundCheck,
            "Human approval",
            "Reviewers validate, challenge, and approve knowledge."
          ],
          [ShieldCheck, "Enforce in context", "Approved knowledge guides agents and blocks risk."]
        ].map(([Icon, title, body], index) => {
          const StepIcon = Icon as typeof Database;
          return (
            <div className="workflow-step" key={String(title)}>
              <span className="workflow-step__number">{index + 1}</span>
              <span className="workflow-step__icon">
                <StepIcon size={21} />
              </span>
              <div>
                <strong>{String(title)}</strong>
                <p>{String(body)}</p>
              </div>
            </div>
          );
        })}
        <button className="text-link" onClick={() => onNavigate("settings")}>
          Learn how to use Lore <ExternalLink size={14} />
        </button>
      </aside>

      {context && <ContextModal context={context} onClose={() => setContext(undefined)} />}
    </div>
  );
}

function ContextModal({ context, onClose }: { context: ContextPackage; onClose: () => void }) {
  const allKnowledge = [
    ...context.policies,
    ...context.rules,
    ...context.decisions,
    ...context.preferences
  ];
  return (
    <Modal
      title="Context package ready"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="modal-note">
            <CheckCircle2 size={16} /> Prepared from the current indexed state
          </span>
          <Button variant="primary" onClick={onClose}>
            Use this context
          </Button>
        </>
      }
    >
      <div className="context-summary">
        <div className="context-summary__top">
          <span>Task</span>
          <strong>{context.task.text}</strong>
          <small>
            {context.repository.owner}/{context.repository.name} · generated now
          </small>
        </div>
        <div className="context-columns">
          <section>
            <h3>Relevant code</h3>
            {context.candidateFiles.map((file) => (
              <div className="context-item" key={file.path}>
                <FileCode2 size={16} />
                <span>
                  <strong>{file.path}</strong>
                  <small>{file.reason}</small>
                </span>
                <em>{Math.round(file.confidence * 100)}%</em>
              </div>
            ))}
          </section>
          <section>
            <h3>Potential impact</h3>
            {context.affectedAreas.slice(0, 5).map((area) => (
              <div className="context-item" key={area.name}>
                <Link2 size={16} />
                <span>
                  <strong>{area.name}</strong>
                  <small>{area.reason}</small>
                </span>
                <em>{Math.round(area.confidence * 100)}%</em>
              </div>
            ))}
          </section>
        </div>
        <section className="context-knowledge">
          <h3>Knowledge included</h3>
          {allKnowledge.map((entry) => (
            <div key={entry.id}>
              <span className={`priority priority--${entry.priority}`}>{entry.priority}</span>
              <strong>{"title" in entry.item ? entry.item.title : entry.item.name}</strong>
              <p>
                <b>Action:</b>{" "}
                {"statement" in entry.item ? entry.item.statement : entry.item.description}
              </p>
              <p>{entry.reason}</p>
              <small>
                {entry.evidence[0]
                  ? `${entry.evidence.length} evidence source${entry.evidence.length === 1 ? "" : "s"} · ${entry.evidence[0].title ?? entry.evidence[0].externalId}`
                  : "owner" in entry.item
                    ? `Human-authored policy · owner ${entry.item.owner}`
                    : "No linked evidence; treat as unconfirmed"}
              </small>
            </div>
          ))}
        </section>
        <section className="context-tests">
          <h3>Recommended tests</h3>
          {context.recommendedTests.map((test) => (
            <p key={test.path}>
              <Check size={15} /> <strong>{test.path}</strong> — {test.reason}
            </p>
          ))}
        </section>
        {context.unknowns.map((unknown) => (
          <div className="unknown-callout" key={unknown.statement}>
            <CircleHelp size={18} />
            <span>
              <strong>Known unknown</strong>
              {unknown.statement} {unknown.suggestion}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function CandidatesPage({
  candidates,
  knowledge,
  onApprove,
  onReject,
  onMerge
}: {
  candidates: CandidateRecord[];
  knowledge: KnowledgeItem[];
  onApprove: (
    candidate: CandidateRecord,
    draft: Pick<CandidateRecord, "statement" | "kind" | "scope">
  ) => Promise<void>;
  onReject: (candidate: CandidateRecord) => Promise<void>;
  onMerge: (candidate: CandidateRecord, targetId: string) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(candidates[0]?.id);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [statement, setStatement] = useState(candidates[0]?.statement ?? "");
  const [draftKind, setDraftKind] = useState<KnowledgeKind>(candidates[0]?.kind ?? "rule");
  const [draftScope, setDraftScope] = useState<KnowledgeScope>(candidates[0]?.scope ?? {});
  const [scopeOpen, setScopeOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [working, setWorking] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const filtered = candidates.filter(
    (candidate) =>
      (filter === "all" || candidate.kind === filter) &&
      `${candidate.title} ${candidate.statement}`.toLowerCase().includes(query.toLowerCase())
  );
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? filtered[0];
  const mergeTargets = [
    ...knowledge.filter((item) => item.status !== "rejected" && item.status !== "archived"),
    ...candidates.filter((item) => item.id !== selected?.id)
  ];

  useEffect(() => {
    if (!selected) return;
    setStatement(selected.statement);
    setDraftKind(selected.kind);
    setDraftScope(selected.scope);
  }, [selected?.id]);

  const select = (candidate: CandidateRecord): void => {
    setSelectedId(candidate.id);
    setStatement(candidate.statement);
    setDraftKind(candidate.kind);
    setDraftScope(candidate.scope);
    if (window.matchMedia("(max-width: 900px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "start" }));
    }
  };

  return (
    <div className="candidate-page">
      <PageHeader
        title="Review what Lore learned"
        description="Every candidate stays advisory until evidence and scope earn your trust."
        actions={<span className="header-meta">{candidates.length} pending</span>}
      />
      <div className="candidate-workspace">
        <aside className="candidate-list">
          <div className="candidate-search">
            <Search size={17} />
            <input
              name="candidateSearch"
              placeholder="Search candidates…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button aria-label="Filter">
              <Filter size={17} />
            </button>
          </div>
          <div className="candidate-tabs">
            {["all", "decision", "rule", "preference", "warning"].map((item) => (
              <button
                className={filter === item ? "is-active" : ""}
                key={item}
                onClick={() => setFilter(item)}
              >
                {item === "all" ? "All" : `${item[0]?.toUpperCase()}${item.slice(1)}s`}
              </button>
            ))}
          </div>
          <div className="candidate-scroll">
            {filtered.map((candidate) => (
              <button
                className={
                  candidate.id === selected?.id ? "candidate-row is-selected" : "candidate-row"
                }
                key={candidate.id}
                onClick={() => select(candidate)}
              >
                <KindIcon kind={candidate.kind} />
                <span>
                  <strong>{candidate.title}</strong>
                  <small>
                    {candidate.kind} · <em>{Math.round(candidate.confidence * 100)}% confidence</em>{" "}
                    · {candidate.evidenceIds.length} sources
                    {candidate.comparison ? ` · ${dispositionLabel(candidate.comparison.disposition)}` : ""}
                  </small>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
            {!filtered.length && (
              <EmptyState
                title="Nothing matches"
                body="Try a different search or candidate class."
              />
            )}
          </div>
          <footer>
            {filtered.length
              ? `1–${filtered.length} of ${candidates.length} candidates`
              : "0 candidates"}
          </footer>
        </aside>

        {selected ? (
          <main className="candidate-detail" ref={detailRef}>
            <div className="candidate-detail__heading">
              <h2>{selected.title}</h2>
              <div>
                <span>Proposed {draftKind}</span>
                <i />{" "}
                <span>
                  Strongly supported · <strong>{Math.round(selected.confidence * 100)}%</strong>
                </span>
                <i />
                <span className="status-label">Candidate</span>
              </div>
            </div>
            {selected.comparison && (
              <div className={`candidate-comparison candidate-comparison--${selected.comparison.disposition}`}>
                <Sparkles size={16} />
                <span>
                  <strong>{dispositionLabel(selected.comparison.disposition)}</strong>
                  {selected.comparison.explanation}
                </span>
              </div>
            )}
            <label className="statement-editor">
              <span>Statement</span>
              <textarea
                name="candidateStatement"
                value={statement}
                onChange={(event) => setStatement(event.target.value)}
              />
            </label>
            <section className="scope-summary">
              <div>
                <span>Repository</span>
                <strong>{draftScope.repository ?? "Organisation"}</strong>
              </div>
              <div>
                <span>Paths</span>
                <strong>{draftScope.paths?.join(", ") ?? "All paths"}</strong>
              </div>
              <div>
                <span>Excludes</span>
                <strong>{draftScope.excludedPaths?.join(", ") ?? "None"}</strong>
              </div>
              <Button variant="secondary" onClick={() => setScopeOpen(true)}>
                Edit scope
              </Button>
            </section>
            <div className="candidate-evidence-layout">
              <section className="evidence-timeline">
                <h3>Why Lore believes this</h3>
                {selected.evidence.map((item) => (
                  <article key={item.id}>
                    <span className="timeline-check">
                      <Check size={13} />
                    </span>
                    <div>
                      <strong>{item.title ?? item.externalId}</strong>
                      <time>{formatDate(item.occurredAt)}</time>
                      <p>“{item.content}”</p>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noreferrer">
                          Open evidence <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </section>
              <aside className="confidence-box">
                <h3>Confidence explanation</h3>
                <dl>
                  <div>
                    <dt>Independent PRs</dt>
                    <dd>{selected.confidenceFactors.independentPullRequests}</dd>
                  </div>
                  <div>
                    <dt>Reviewers</dt>
                    <dd>{selected.confidenceFactors.independentReviewers}</dd>
                  </div>
                  <div>
                    <dt>Recency</dt>
                    <dd className="positive">
                      {Math.round(selected.confidenceFactors.recency * 100)}%
                    </dd>
                  </div>
                  <div>
                    <dt>Contradictions</dt>
                    <dd className="caution">−{selected.confidenceFactors.contradictions * 4}%</dd>
                  </div>
                  <div>
                    <dt>Human confirmed</dt>
                    <dd>{selected.confidenceFactors.humanConfirmed ? "Yes" : "No"}</dd>
                  </div>
                  <div className="confidence-total">
                    <dt>Overall confidence</dt>
                    <dd>{Math.round(selected.confidence * 100)}%</dd>
                  </div>
                </dl>
              </aside>
            </div>
            <section className="contradictions">
              <h3>Contradictions & limits</h3>
              {selected.contradictionSummaries.length ? (
                selected.contradictionSummaries.map((summary) => (
                  <p key={summary}>
                    <AlertTriangle size={17} />
                    {summary}
                  </p>
                ))
              ) : (
                <p className="contradictions--clear">
                  <CheckCircle2 size={17} />
                  No contradictory evidence found.
                </p>
              )}
            </section>
            <footer className="candidate-actions">
              <span>
                <ShieldCheck size={16} /> Approval creates an audited knowledge revision.
              </span>
              <Button
                variant="secondary"
                disabled={working}
                onClick={() => {
                  setWorking(true);
                  void onReject(selected).finally(() => setWorking(false));
                }}
              >
                Reject
              </Button>
              <Button
                variant="secondary"
                disabled={working || mergeTargets.length === 0}
                onClick={() => {
                  setMergeTargetId(
                    selected.comparison?.matchedKnowledgeIds.find((id) =>
                      mergeTargets.some((item) => item.id === id)
                    ) ?? mergeTargets[0]?.id ?? ""
                  );
                  setMergeOpen(true);
                }}
              >
                Merge
              </Button>
              <Button variant="secondary" onClick={() => setTypeOpen(true)}>
                Change type
              </Button>
              <Button
                variant="primary"
                disabled={working}
                onClick={() => {
                  setWorking(true);
                  void onApprove(selected, {
                    statement,
                    kind: draftKind,
                    scope: draftScope
                  }).finally(() => setWorking(false));
                }}
              >
                {working ? "Saving…" : "Approve candidate"}
              </Button>
            </footer>
            {scopeOpen && (
              <Modal
                title="Edit candidate scope"
                onClose={() => setScopeOpen(false)}
                footer={
                  <>
                    <Button variant="secondary" onClick={() => setScopeOpen(false)}>
                      Cancel
                    </Button>
                    <Button variant="primary" onClick={() => setScopeOpen(false)}>
                      Apply scope
                    </Button>
                  </>
                }
              >
                <div className="form-stack">
                  <FormField label="Repository">
                    <input
                      name="scopeRepository"
                      value={draftScope.repository ?? ""}
                      onChange={(event) =>
                        setDraftScope((scope) => ({
                          ...scope,
                          repository: event.target.value || undefined
                        }))
                      }
                      placeholder="owner/repository"
                    />
                  </FormField>
                  <FormField label="Paths" hint="One glob per line">
                    <textarea
                      name="scopePaths"
                      value={draftScope.paths?.join("\n") ?? ""}
                      onChange={(event) =>
                        setDraftScope((scope) => ({
                          ...scope,
                          paths: event.target.value
                            .split("\n")
                            .map((value) => value.trim())
                            .filter(Boolean)
                        }))
                      }
                    />
                  </FormField>
                  <FormField
                    label="Excluded paths"
                    hint="Valid exceptions stay narrow instead of weakening the rule"
                  >
                    <textarea
                      name="scopeExcludedPaths"
                      value={draftScope.excludedPaths?.join("\n") ?? ""}
                      onChange={(event) =>
                        setDraftScope((scope) => ({
                          ...scope,
                          excludedPaths: event.target.value
                            .split("\n")
                            .map((value) => value.trim())
                            .filter(Boolean)
                        }))
                      }
                    />
                  </FormField>
                </div>
              </Modal>
            )}
            {typeOpen && (
              <Modal
                title="Change knowledge class"
                onClose={() => setTypeOpen(false)}
                footer={
                  <Button variant="primary" onClick={() => setTypeOpen(false)}>
                    Apply class
                  </Button>
                }
              >
                <FormField label="Classification">
                  <select
                    name="candidateKind"
                    value={draftKind}
                    onChange={(event) => setDraftKind(event.target.value as KnowledgeKind)}
                  >
                    {[
                      "fact",
                      "decision",
                      "rule",
                      "preference",
                      "inference",
                      "regression",
                      "warning"
                    ].map((kind) => (
                      <option value={kind} key={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </FormField>
                <div className="info-callout">
                  <CircleHelp size={18} />
                  <span>
                    Preferences remain reviewer-scoped and advisory. Policies cannot be created from
                    candidates.
                  </span>
                </div>
              </Modal>
            )}
            {mergeOpen && (
              <Modal
                title="Merge duplicate candidate"
                onClose={() => setMergeOpen(false)}
                footer={
                  <>
                    <Button variant="secondary" onClick={() => setMergeOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      disabled={working || !mergeTargetId}
                      onClick={() => {
                        setWorking(true);
                        void onMerge(selected, mergeTargetId)
                          .then(() => setMergeOpen(false))
                          .finally(() => setWorking(false));
                      }}
                    >
                      {working ? "Merging…" : "Merge and preserve evidence"}
                    </Button>
                  </>
                }
              >
                <div className="form-stack">
                  <div className="info-callout">
                    <History size={18} />
                    <span>
                      <strong>No evidence is discarded</strong> The duplicate is superseded, its
                      evidence is linked to the target, and the action is audited.
                    </span>
                  </div>
                  <FormField label="Merge into">
                    <select
                      name="mergeTarget"
                      value={mergeTargetId}
                      onChange={(event) => setMergeTargetId(event.target.value)}
                    >
                      <optgroup label="Approved knowledge">
                        {knowledge
                          .filter((item) => item.status !== "rejected" && item.status !== "archived")
                          .map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.title}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Other candidates">
                        {candidates
                          .filter((item) => item.id !== selected.id)
                          .map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.title}
                          </option>
                          ))}
                      </optgroup>
                    </select>
                  </FormField>
                </div>
              </Modal>
            )}
          </main>
        ) : (
          <EmptyState
            title="Candidate queue is clear"
            body="New evidence-backed proposals will appear here for human review."
          />
        )}
      </div>
    </div>
  );
}

export function KnowledgePage({
  items,
  repositories,
  onCreate,
  onStatusChange,
  onReviewCandidates
}: {
  items: KnowledgeItem[];
  repositories: RepositorySummary[];
  onCreate: (input: Record<string, unknown>) => Promise<void>;
  onStatusChange: (
    item: KnowledgeItem,
    status: "challenged" | "archived",
    reason: string
  ) => Promise<void>;
  onReviewCandidates: () => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<KnowledgeItem>();
  const [addOpen, setAddOpen] = useState(false);
  const [action, setAction] = useState<"challenged" | "archived">();
  const [reason, setReason] = useState("");
  const [form, setForm] = useState({
    repositoryId: repositories[0]?.id ?? "",
    kind: "decision",
    title: "",
    statement: "",
    rationale: "",
    severity: "warning",
    paths: ""
  });
  const [saving, setSaving] = useState(false);
  const filtered = items.filter(
    (item) =>
      (kind === "all" || item.kind === kind) &&
      `${item.title} ${item.statement}`.toLowerCase().includes(query.toLowerCase())
  );
  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    try {
      const scopedRepository = repositories.find(
        (repository) => repository.id === form.repositoryId
      );
      await onCreate({
        repositoryId: form.repositoryId || undefined,
        kind: form.kind,
        title: form.title,
        statement: form.statement,
        rationale: form.rationale,
        severity: form.severity,
        scope: {
          ...(scopedRepository
            ? { repository: `${scopedRepository.owner}/${scopedRepository.name}` }
            : {}),
          ...(form.paths.trim()
            ? {
                paths: form.paths
                  .split("\n")
                  .map((path) => path.trim())
                  .filter(Boolean)
              }
            : {})
        }
      });
      setAddOpen(false);
      setForm((current) => ({ ...current, title: "", statement: "", rationale: "", paths: "" }));
    } finally {
      setSaving(false);
    }
  };
  const applyAction = async (): Promise<void> => {
    if (!selected || !action) return;
    setSaving(true);
    try {
      await onStatusChange(selected, action, reason);
      setAction(undefined);
      setReason("");
      setSelected(undefined);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="page-pad">
      <PageHeader
        title="Knowledge"
        description="Browse the decisions, rules, facts, and preferences Lore can prove."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setAddOpen(true)}>
            Add knowledge
          </Button>
        }
      />
      <div className="toolbar">
        <div className="search-input">
          <Search size={16} />
          <input
            name="knowledgeSearch"
            aria-label="Search knowledge"
            placeholder="Search statements, symbols, or evidence…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          name="knowledgeKind"
          aria-label="Knowledge class"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="all">All classes</option>
          <option value="decision">Decisions</option>
          <option value="rule">Rules</option>
          <option value="fact">Facts</option>
          <option value="preference">Preferences</option>
          <option value="warning">Warnings</option>
        </select>
        <Button variant="secondary" icon={<ListFilter size={16} />}>
          More filters
        </Button>
      </div>
      <div className="knowledge-table data-table">
        <div className="data-table__header">
          <span>Knowledge</span>
          <span>Class</span>
          <span>Scope</span>
          <span>Confidence</span>
          <span>Health</span>
          <span>Evidence</span>
        </div>
        {filtered.map((item) => (
          <button className="data-table__row" key={item.id} onClick={() => setSelected(item)}>
            <span className="table-primary">
              <KindIcon kind={item.kind} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.statement}</small>
              </span>
            </span>
            <span>{item.kind}</span>
            <span>{item.scope.repository ?? "Organisation"}</span>
            <span>
              <Confidence value={item.confidence} />
            </span>
            <span className={`health-text health-text--${item.health}`}>
              {item.health.replace("_", " ")}
            </span>
            <span>
              {item.evidenceIds.length}
              <ChevronRight size={16} />
            </span>
          </button>
        ))}
        {!filtered.length && (
          <EmptyState
            title={items.length ? "No knowledge matches" : "No approved knowledge yet"}
            body={items.length
              ? "Try a different search or classification."
              : "AI extraction creates evidence-backed candidates first. Review and approve them before they become trusted knowledge."}
            action={!items.length ? <Button variant="secondary" onClick={onReviewCandidates}>Review candidates</Button> : undefined}
          />
        )}
      </div>
      {selected && !action && (
        <Modal
          title={selected.title}
          wide
          onClose={() => setSelected(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAction("challenged")}>
                Challenge
              </Button>
              <Button variant="danger" onClick={() => setAction("archived")}>
                Archive
              </Button>
            </>
          }
        >
          <div className="knowledge-detail">
            <div className="knowledge-detail__statement">{selected.statement}</div>
            <dl>
              <div>
                <dt>Classification</dt>
                <dd>{selected.kind}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{selected.status}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{Math.round(selected.confidence * 100)}%</dd>
              </div>
              <div>
                <dt>Last confirmed</dt>
                <dd>{selected.lastConfirmedAt ? formatDate(selected.lastConfirmedAt) : "Never"}</dd>
              </div>
            </dl>
            <h3>Why this exists</h3>
            <p>{selected.rationale}</p>
            <h3>Scope</h3>
            <pre>{JSON.stringify(selected.scope, null, 2)}</pre>
            <h3>Provenance</h3>
            <p>
              {selected.evidenceIds.length} linked evidence record
              {selected.evidenceIds.length === 1 ? "" : "s"}. Every revision and review action
              remains in the audit log.
            </p>
          </div>
        </Modal>
      )}
      {addOpen && (
        <Modal
          title="Confirm human knowledge"
          onClose={() => setAddOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" form="add-knowledge" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Confirm knowledge"}
              </Button>
            </>
          }
        >
          <form id="add-knowledge" className="form-stack" onSubmit={(event) => void create(event)}>
            <div className="info-callout">
              <ShieldCheck size={18} />
              <span>
                <strong>Human confirmation is strong evidence</strong> Keep the statement precise
                and scope it to where it is actually true.
              </span>
            </div>
            <div className="form-grid">
              <FormField label="Class">
                <select
                  name="knowledgeKind"
                  value={form.kind}
                  onChange={(event) => setForm({ ...form, kind: event.target.value })}
                >
                  {["fact", "decision", "rule", "preference", "regression", "warning"].map(
                    (value) => (
                      <option key={value}>{value}</option>
                    )
                  )}
                </select>
              </FormField>
              <FormField label="Severity">
                <select
                  name="knowledgeSeverity"
                  value={form.severity}
                  onChange={(event) => setForm({ ...form, severity: event.target.value })}
                >
                  {["info", "suggestion", "warning", "error", "blocker"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <FormField label="Title">
              <input
                name="knowledgeTitle"
                required
                minLength={3}
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </FormField>
            <FormField label="Statement">
              <textarea
                name="knowledgeStatement"
                required
                minLength={8}
                value={form.statement}
                onChange={(event) => setForm({ ...form, statement: event.target.value })}
              />
            </FormField>
            <FormField label="Rationale">
              <textarea
                name="knowledgeRationale"
                required
                minLength={3}
                value={form.rationale}
                onChange={(event) => setForm({ ...form, rationale: event.target.value })}
              />
            </FormField>
            <FormField label="Repository">
              <select
                name="knowledgeRepositoryId"
                value={form.repositoryId}
                onChange={(event) => setForm({ ...form, repositoryId: event.target.value })}
              >
                <option value="">Organisation-wide</option>
                {repositories.map((repository) => (
                  <option value={repository.id} key={repository.id}>
                    {repository.owner}/{repository.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Paths" hint="Optional; one repository-relative glob per line">
              <textarea
                name="knowledgePaths"
                value={form.paths}
                onChange={(event) => setForm({ ...form, paths: event.target.value })}
                placeholder="src/Tax/**"
              />
            </FormField>
          </form>
        </Modal>
      )}
      {selected && action && (
        <Modal
          title={action === "challenged" ? "Challenge this knowledge" : "Archive this knowledge"}
          onClose={() => setAction(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAction(undefined)}>
                Cancel
              </Button>
              <Button
                variant={action === "archived" ? "danger" : "primary"}
                disabled={saving || reason.trim().length < 3}
                onClick={() => void applyAction()}
              >
                {saving ? "Saving…" : action === "challenged" ? "Create challenge" : "Archive"}
              </Button>
            </>
          }
        >
          <FormField label="Reason" hint="Required for the audit trail">
            <textarea
              name="knowledgeActionReason"
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
        </Modal>
      )}
    </div>
  );
}

export function RepositoriesPage({
  repositories,
  githubStatus,
  installationId: initialInstallationId,
  onInstallGitHub,
  onConnect,
  onIndex,
  onImport,
  onExtract,
  onDelete,
  onRetention,
  defaultImportLimit = 100,
  showGettingStarted = true
}: {
  repositories: RepositorySummary[];
  githubStatus: {
    mode: "disabled" | "token" | "app" | "demo";
    historicalImportReady: boolean;
    installFlowReady: boolean;
    webhooksReady: boolean;
  };
  installationId?: string;
  onInstallGitHub: () => Promise<void>;
  onConnect: (inputs: Array<Record<string, unknown>>) => Promise<RepositoryBatchConnectionResult>;
  onIndex: (repository: RepositorySummary) => Promise<void>;
  onImport: (repository: RepositorySummary, limit: PullRequestImportLimit) => Promise<void>;
  onExtract: (repository: RepositorySummary) => Promise<void>;
  onDelete: (repository: RepositorySummary, confirmation: string) => Promise<void>;
  onRetention: (
    repository: RepositorySummary,
    retentionConfig: RepositoryRetentionConfig
  ) => Promise<void>;
  defaultImportLimit?: PullRequestImportLimit;
  showGettingStarted?: boolean;
}) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [importRepository, setImportRepository] = useState<RepositorySummary>();
  const [graphRepository, setGraphRepository] = useState<RepositorySummary>();
  const [installationId, setInstallationId] = useState(initialInstallationId ?? "");
  const [importLimit, setImportLimit] = useState<PullRequestImportLimit>(defaultImportLimit);
  const [repositoryReference, setRepositoryReference] = useState("");
  const [selectedGitHubRepositoryIds, setSelectedGitHubRepositoryIds] = useState<string[]>([]);
  const [repositorySearch, setRepositorySearch] = useState("");
  const [availableRepositories, setAvailableRepositories] = useState<GitHubRepositoryOption[]>([]);
  const [repositoriesLoading, setRepositoriesLoading] = useState(false);
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [connectError, setConnectError] = useState<string>();
  const [deleteRepository, setDeleteRepository] = useState<RepositorySummary>();
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [retentionRepository, setRetentionRepository] = useState<RepositorySummary>();
  const [retention, setRetention] = useState<RepositoryRetentionConfig>({
    retainRawPullRequestDiff: false,
    retainSummariesOnly: false,
    retainReviewComments: true,
    retainCodeSnippets: false
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!initialInstallationId) return;
    setInstallationId(initialInstallationId);
    setConnectOpen(true);
  }, [initialInstallationId]);
  useEffect(() => {
    if (!connectOpen || (githubStatus.mode !== "token" && githubStatus.mode !== "demo")) return;
    let cancelled = false;
    setRepositoriesLoading(true);
    void loreApi.githubRepositories().then(({ items }) => {
      if (!cancelled) setAvailableRepositories(items);
    }).catch((error: unknown) => {
      if (!cancelled) setConnectError(error instanceof Error ? error.message : "GitHub repositories could not be loaded");
    }).finally(() => {
      if (!cancelled) setRepositoriesLoading(false);
    });
    return () => { cancelled = true; };
  }, [connectOpen, githubStatus.mode]);
  const connectedRepositoryKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const repository of repositories) {
      keys.add(`name:${repository.owner.toLowerCase()}/${repository.name.toLowerCase()}`);
      if (repository.providerRepositoryId) keys.add(`id:${repository.providerRepositoryId}`);
    }
    return keys;
  }, [repositories]);
  const isConnected = (repository: GitHubRepositoryOption): boolean =>
    connectedRepositoryKeys.has(`id:${repository.id}`) ||
    connectedRepositoryKeys.has(`name:${repository.fullName.toLowerCase()}`);
  const filteredRepositories = useMemo(() => {
    const query = repositorySearch.trim().toLowerCase();
    if (!query) return availableRepositories;
    return availableRepositories.filter((repository) =>
      repository.fullName.toLowerCase().includes(query) ||
      repository.description?.toLowerCase().includes(query)
    );
  }, [availableRepositories, repositorySearch]);
  const selectableFilteredRepositories = filteredRepositories.filter((repository) => !isConnected(repository));
  const selectedRepositoryIds = new Set(selectedGitHubRepositoryIds);
  const allFilteredSelected = selectableFilteredRepositories.length > 0 &&
    selectableFilteredRepositories.every((repository) => selectedRepositoryIds.has(repository.id));
  const toggleFilteredRepositories = (): void => {
    const next = new Set(selectedGitHubRepositoryIds);
    if (allFilteredSelected) {
      for (const repository of selectableFilteredRepositories) next.delete(repository.id);
    } else {
      for (const repository of selectableFilteredRepositories) {
        if (next.size >= MAX_REPOSITORIES_PER_BATCH) break;
        next.add(repository.id);
      }
    }
    setSelectedGitHubRepositoryIds([...next]);
  };
  const closeConnect = (): void => {
    setConnectOpen(false);
    setRepositoryReference("");
    setSelectedGitHubRepositoryIds([]);
    setRepositorySearch("");
    setDefaultBranch("main");
    setConnectError(undefined);
  };
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setConnectError(undefined);
    try {
      const selectedRepositories = availableRepositories.filter((repository) =>
        selectedRepositoryIds.has(repository.id) && !isConnected(repository)
      );
      const inputs: Array<Record<string, unknown>> = selectedRepositories.length
        ? selectedRepositories.map((repository) => ({
            provider: "github",
            providerRepositoryId: repository.id,
            owner: repository.owner,
            name: repository.name,
            defaultBranch: repository.defaultBranch,
            cloneUrl: repository.cloneUrl
          }))
        : (() => {
            const { owner, name } = parseGitHubRepositoryReference(repositoryReference);
            return [{
              provider: "github",
              owner,
              name,
              defaultBranch,
              ...(installationId ? { providerInstallationId: installationId } : {})
            }];
          })();
      const result = await onConnect(inputs);
      if (!result.connected && result.skipped.length) {
        setConnectError("Every selected repository is already connected to this organisation.");
        setSelectedGitHubRepositoryIds([]);
        return;
      }
      closeConnect();
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Repository could not be connected");
    } finally {
      setSaving(false);
    }
  };
  const importHistory = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!importRepository) return;
    setSaving(true);
    try {
      await onImport(importRepository, importLimit);
      setImportRepository(undefined);
    } finally {
      setSaving(false);
    }
  };
  const removeRepository = async (): Promise<void> => {
    if (!deleteRepository) return;
    setSaving(true);
    try {
      await onDelete(deleteRepository, deleteConfirmation);
      setDeleteRepository(undefined);
      setDeleteConfirmation("");
    } finally {
      setSaving(false);
    }
  };
  const saveRetention = async (): Promise<void> => {
    if (!retentionRepository) return;
    setSaving(true);
    try {
      await onRetention(retentionRepository, retention);
      setRetentionRepository(undefined);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="page-pad">
      <PageHeader
        title="Repositories"
        description="Connect source history, then keep code structure and evidence current."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => {
            setConnectError(undefined);
            setConnectOpen(true);
          }}>
            Connect repositories
          </Button>
        }
      />
      {showGettingStarted && <div className="onboarding-strip">
        <div>
          <strong>Get a repository ready in three steps</strong>
          <p>Connect GitHub, import merged pull requests, then index the local checkout.</p>
        </div>
        {["Repository connected", "History imported", "Local graph indexed"].map((step, index) => (
          <span key={step} className={index === 0 && repositories.length > 0 ? "is-complete" : ""}>
            <i>{index === 0 && repositories.length > 0 ? <Check size={13} /> : index + 1}</i>
            {step}
          </span>
        ))}
      </div>}
      <div className="repository-list">
        {!repositories.length && (
          <EmptyState
            title="No repositories connected"
            body="Choose any repositories available to your GitHub token. Lore keeps each repository's evidence, imports, retention, and indexing state separate inside this organisation."
            action={<Button variant="primary" onClick={() => setConnectOpen(true)}>Choose repositories</Button>}
          />
        )}
        {repositories.map((repository) => (
          <article key={repository.id}>
            <div className="repo-icon">
              <GitBranch size={21} />
            </div>
            <div className="repo-info">
              <h2>
                {repository.owner}/{repository.name}
              </h2>
              <p>
                {repository.provider} · {repository.defaultBranch} · {repository.status}
              </p>
            </div>
            <dl>
              <div>
                <dt>Entities</dt>
                <dd>{repository.entityCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Relationships</dt>
                <dd>{repository.relationshipCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Last indexed</dt>
                <dd>{repository.indexedAt ? relativeTime(repository.indexedAt) : "Never"}</dd>
              </div>
            </dl>
            <div className="repo-actions">
              <Button
                variant="quiet"
                onClick={() => setGraphRepository(repository)}
                icon={<Braces size={15} />}
              >
                Browse graph
              </Button>
              {repository.provider === "github" && (
                <Button
                  variant="quiet"
                  onClick={() => setImportRepository(repository)}
                  icon={<History size={15} />}
                >
                  Import history
                </Button>
              )}
              <Button
                variant="quiet"
                onClick={() => void onExtract(repository)}
                icon={<Sparkles size={15} />}
              >
                Extract evidence
              </Button>
              <Button
                variant="secondary"
                onClick={() => void onIndex(repository)}
                icon={<Play size={15} />}
              >
                Index now
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setRetentionRepository(repository);
                  setRetention(
                    repository.retentionConfig ?? {
                      retainRawPullRequestDiff: false,
                      retainSummariesOnly: false,
                      retainReviewComments: true,
                      retainCodeSnippets: false
                    }
                  );
                }}
                icon={<ShieldCheck size={15} />}
              >
                Retention
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setDeleteRepository(repository);
                  setDeleteConfirmation("");
                }}
                icon={<Trash2 size={15} />}
              >
                Delete
              </Button>
            </div>
            <button className="repo-open" aria-label={`Browse ${repository.owner}/${repository.name} code graph`} onClick={() => setGraphRepository(repository)}>
              <ChevronRight size={18} />
            </button>
          </article>
        ))}
      </div>
      {graphRepository && <RepositoryGraphModal repository={graphRepository} onClose={() => setGraphRepository(undefined)} />}
      {connectOpen && (
        <Modal
          title="Connect GitHub repositories"
          wide={githubStatus.mode === "token" || githubStatus.mode === "demo"}
          onClose={closeConnect}
          footer={
            <>
              <Button variant="secondary" onClick={closeConnect}>
                Cancel
              </Button>
              <Button
                variant="primary"
                form="connect-repository"
                type="submit"
                disabled={
                  saving ||
                  (!selectedGitHubRepositoryIds.length && (!repositoryReference.trim() || !defaultBranch.trim())) ||
                  !githubStatus.historicalImportReady ||
                  (githubStatus.mode === "app" && !installationId)
                }
              >
                {saving
                  ? "Connecting…"
                  : selectedGitHubRepositoryIds.length
                    ? `Connect ${selectedGitHubRepositoryIds.length} ${selectedGitHubRepositoryIds.length === 1 ? "repository" : "repositories"}`
                    : "Connect repository"}
              </Button>
            </>
          }
        >
          <form
            id="connect-repository"
            className="form-stack"
            onSubmit={(event) => void submit(event)}
          >
            <div className="info-callout">
              <GitBranch size={19} />
              <span>
                {githubStatus.mode === "token" ? (
                  <>
                    <strong>Local token mode is ready</strong> The token stays in the worker
                    and API environments; the browser receives repository metadata, never the token.
                  </>
                ) : githubStatus.mode === "demo" ? (
                  <>
                    <strong>Demo connection</strong> No GitHub credentials are used until persistent
                    mode is enabled.
                  </>
                ) : githubStatus.mode === "app" ? (
                  <>
                    <strong>Install the Lore GitHub App first</strong> Lore will return here and
                    prefill the installation identity used to scope imports and webhooks.
                  </>
                ) : (
                  <>
                    <strong>GitHub is not configured</strong> For a local installation, set only
                    <code> GITHUB_TOKEN</code> and restart Lore. Hosted deployments use the separate
                    SaaS configuration.
                  </>
                )}
              </span>
            </div>
            {githubStatus.mode === "app" && !installationId && githubStatus.installFlowReady && (
              <Button type="button" variant="secondary" onClick={() => void onInstallGitHub()}>
                Install GitHub App
              </Button>
            )}
            {(githubStatus.mode === "token" || githubStatus.mode === "demo") && (
              <section className="repository-discovery" aria-labelledby="repository-discovery-title">
                <header>
                  <div>
                    <strong id="repository-discovery-title">
                      {githubStatus.mode === "demo"
                        ? "Development fixture repositories"
                        : "Repositories available to your token"}
                    </strong>
                    <small>
                      {repositoriesLoading
                        ? githubStatus.mode === "demo"
                          ? "Loading mocked repositories…"
                          : "Loading every repository the token can read…"
                        : `${availableRepositories.length} ${githubStatus.mode === "demo" ? "mocked" : "accessible"} · ${repositories.length} connected to this organisation`}
                    </small>
                  </div>
                  <span>{selectedGitHubRepositoryIds.length} selected</span>
                </header>
                <div className="repository-discovery__toolbar">
                  <label>
                    <Search size={15} />
                    <input
                      type="search"
                      name="repositorySearch"
                      value={repositorySearch}
                      onChange={(event) => setRepositorySearch(event.target.value)}
                      placeholder="Search owner, repository, or description"
                      aria-label="Search accessible GitHub repositories"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!selectableFilteredRepositories.length}
                    onClick={toggleFilteredRepositories}
                  >
                    {allFilteredSelected ? "Clear results" : `Select results (${Math.min(selectableFilteredRepositories.length, MAX_REPOSITORIES_PER_BATCH)})`}
                  </button>
                </div>
                <div className="repository-discovery__list" role="list" aria-label="Accessible GitHub repositories">
                  {repositoriesLoading && (
                    <div className="repository-discovery__state"><LoaderCircle className="spin" size={18} /> Loading repositories…</div>
                  )}
                  {!repositoriesLoading && !filteredRepositories.length && (
                    <div className="repository-discovery__state">No accessible repositories match this search.</div>
                  )}
                  {!repositoriesLoading && filteredRepositories.map((repository) => {
                    const connected = isConnected(repository);
                    const selected = selectedRepositoryIds.has(repository.id);
                    return (
                      <label
                        className={`repository-option${connected ? " is-connected" : ""}${selected ? " is-selected" : ""}`}
                        key={repository.id}
                        role="listitem"
                      >
                        <input
                          type="checkbox"
                          name="repositorySelection"
                          checked={selected}
                          disabled={connected || (!selected && selectedGitHubRepositoryIds.length >= MAX_REPOSITORIES_PER_BATCH)}
                          onChange={(event) => setSelectedGitHubRepositoryIds((current) =>
                            event.target.checked
                              ? [...current, repository.id]
                              : current.filter((id) => id !== repository.id)
                          )}
                        />
                        <span>
                          <strong>{repository.fullName}</strong>
                          <small>{repository.description || `${repository.defaultBranch} default branch`}</small>
                        </span>
                        <em>
                          {connected ? "Connected" : repository.archived ? "Archived" : repository.private ? "Private" : "Public"}
                        </em>
                      </label>
                    );
                  })}
                </div>
                <footer>
                  <span>
                    {githubStatus.mode === "demo"
                      ? "These fixtures exist only in development demo mode and reset with the API."
                      : "Your organisation controls the imported evidence; it never limits GitHub discovery."}
                  </span>
                  <small>Connect up to {MAX_REPOSITORIES_PER_BATCH} per action and repeat for larger accounts.</small>
                </footer>
              </section>
            )}
            {githubStatus.mode === "token" || githubStatus.mode === "demo" ? (
              <details className="manual-repository-connect">
                <summary>Connect a repository by URL instead</summary>
                <div className="form-grid">
                  <FormField
                    label="GitHub repository"
                    hint="Paste the complete GitHub URL or enter OWNER/REPOSITORY."
                  >
                    <input
                      name="repositoryReference"
                      required={!selectedGitHubRepositoryIds.length}
                      value={repositoryReference}
                      onChange={(event) => setRepositoryReference(event.target.value)}
                      placeholder="https://github.com/acme/commerce"
                    />
                  </FormField>
                  <FormField label="Default branch" hint="Used by local indexing and context links.">
                    <input
                      name="defaultBranch"
                      required={!selectedGitHubRepositoryIds.length}
                      value={defaultBranch}
                      onChange={(event) => setDefaultBranch(event.target.value)}
                      placeholder="main"
                    />
                  </FormField>
                </div>
              </details>
            ) : (
              <div className="form-grid">
              <FormField
                label="GitHub repository"
                hint="Paste the complete GitHub URL or enter OWNER/REPOSITORY."
              >
                <input
                  name="repositoryReference"
                  required
                  value={repositoryReference}
                  onChange={(event) => setRepositoryReference(event.target.value)}
                  placeholder="https://github.com/acme/commerce"
                />
              </FormField>
              <FormField label="Default branch" hint="Used by local indexing and context links.">
                <input
                  name="defaultBranch"
                  required
                  value={defaultBranch}
                  onChange={(event) => setDefaultBranch(event.target.value)}
                  placeholder="main"
                />
              </FormField>
              </div>
            )}
            {connectError && <div className="form-error">{connectError}</div>}
            {githubStatus.mode === "app" && (
              <FormField
                label="GitHub App installation ID"
                hint="Returned by the configured GitHub App callback"
              >
                <input
                  name="providerInstallationId"
                  required
                  inputMode="numeric"
                  pattern="[0-9]+"
                  value={installationId}
                  onChange={(event) => setInstallationId(event.target.value)}
                />
              </FormField>
            )}
            <div className="info-callout">
              <ShieldCheck size={18} />
              <span>
                Local checkout paths remain with the trusted <code>lore connect</code> client;
                browsers never choose server filesystem paths.
              </span>
            </div>
          </form>
        </Modal>
      )}
      {importRepository && (
        <Modal
          title={`Import ${importRepository.owner}/${importRepository.name} history`}
          onClose={() => setImportRepository(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setImportRepository(undefined)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" form="import-history" disabled={saving}>
                {saving ? "Queueing…" : "Queue import"}
              </Button>
            </>
          }
        >
          <form
            id="import-history"
            className="form-stack"
            onSubmit={(event) => void importHistory(event)}
          >
            <div className="info-callout">
              <History size={19} />
              <span>
                <strong>Start bounded, then expand</strong> “All” walks every merged PR available
                to the configured credential and paginates its reviews, comments, commits, and
                files. Large repositories can take time and consume GitHub API quota.
              </span>
            </div>
            <FormField label="Merged pull requests">
              <select
                name="importLimit"
                value={importLimit}
                onChange={(event) =>
                  setImportLimit(
                    event.target.value === "all"
                      ? "all"
                      : (Number(event.target.value) as 50 | 100 | 250 | 500 | 1000)
                  )
                }
              >
                {[50, 100, 250, 500, 1000].map((limit) => (
                  <option value={limit} key={limit}>
                    {limit}
                  </option>
                ))}
                <option value="all">All merged PRs</option>
              </select>
            </FormField>
          </form>
        </Modal>
      )}
      {deleteRepository && (
        <Modal
          title={`Delete ${deleteRepository.owner}/${deleteRepository.name}`}
          onClose={() => setDeleteRepository(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleteRepository(undefined)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={
                  saving ||
                  deleteConfirmation !== `${deleteRepository.owner}/${deleteRepository.name}`
                }
                onClick={() => void removeRepository()}
              >
                {saving ? "Deleting…" : "Delete repository data"}
              </Button>
            </>
          }
        >
          <div className="form-stack">
            <div className="warning-callout">
              <AlertTriangle size={18} />
              <span>
                Repository-scoped entities, evidence, sessions, reports, and knowledge are deleted.
                Organisation knowledge that relied on this repository is challenged for
                reconfirmation.
              </span>
            </div>
            <FormField label={`Type ${deleteRepository.owner}/${deleteRepository.name} to confirm`}>
              <input
                name="deleteConfirmation"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                autoComplete="off"
              />
            </FormField>
          </div>
        </Modal>
      )}
      {retentionRepository && (
        <Modal
          title={`${retentionRepository.owner}/${retentionRepository.name} retention`}
          onClose={() => setRetentionRepository(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRetentionRepository(undefined)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={saving} onClick={() => void saveRetention()}>
                {saving ? "Saving…" : "Save retention policy"}
              </Button>
            </>
          }
        >
          <div className="form-stack">
            <div className="info-callout">
              <ShieldCheck size={18} />
              <span>
                <strong>Minimise stored source</strong> These settings are applied before GitHub
                evidence is persisted. Existing records are not expanded when a setting changes.
              </span>
            </div>
            <label className="check-row">
              <input
                name="retainSummariesOnly"
                type="checkbox"
                checked={retention.retainSummariesOnly}
                onChange={(event) =>
                  setRetention({
                    ...retention,
                    retainSummariesOnly: event.target.checked,
                    ...(event.target.checked
                      ? { retainRawPullRequestDiff: false, retainCodeSnippets: false }
                      : {})
                  })
                }
              />
              <span>
                <strong>Summaries only</strong>
                <small>Keep bounded titles/summaries instead of raw PR bodies.</small>
              </span>
            </label>
            <label className="check-row">
              <input
                name="retainReviewComments"
                type="checkbox"
                checked={retention.retainReviewComments}
                onChange={(event) =>
                  setRetention({ ...retention, retainReviewComments: event.target.checked })
                }
              />
              <span>
                <strong>Review comments</strong>
                <small>Keep explicit review feedback as evidence.</small>
              </span>
            </label>
            <label className="check-row">
              <input
                name="retainRawPullRequestDiff"
                type="checkbox"
                disabled={retention.retainSummariesOnly}
                checked={retention.retainRawPullRequestDiff}
                onChange={(event) =>
                  setRetention({ ...retention, retainRawPullRequestDiff: event.target.checked })
                }
              />
              <span>
                <strong>Raw PR diffs</strong>
                <small>Opt in to storing bounded GitHub patch data.</small>
              </span>
            </label>
            <label className="check-row">
              <input
                name="retainCodeSnippets"
                type="checkbox"
                disabled={retention.retainSummariesOnly}
                checked={retention.retainCodeSnippets}
                onChange={(event) =>
                  setRetention({ ...retention, retainCodeSnippets: event.target.checked })
                }
              />
              <span>
                <strong>Code snippets</strong>
                <small>Permit future evidence adapters to retain scoped snippets.</small>
              </span>
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function PoliciesPage({
  policies,
  onCreate
}: {
  policies: PolicyRecord[];
  onCreate: (
    policy: Omit<PolicyRecord, "id" | "organisationId" | "createdAt" | "updatedAt">
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pattern, setPattern] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onCreate({
      name,
      description,
      owner: "Current user",
      severity: "blocker",
      scope: { organisation: "acme-engineering" },
      enabled: true,
      detector: { type: "forbidden_pattern", patterns: [pattern], message: description }
    });
    setOpen(false);
  };
  return (
    <div className="page-pad">
      <PageHeader
        title="Policies"
        description="Explicit, human-owned boundaries that can block unsafe changes."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setOpen(true)}>
            Create policy
          </Button>
        }
      />
      <div className="policy-intro">
        <ShieldCheck size={23} />
        <div>
          <strong>Humans control policy</strong>
          <p>
            Lore can identify possible risks, but no AI proposal can create a mandatory policy or
            calculate its enforcement result.
          </p>
        </div>
      </div>
      <div className="policy-list">
        {policies.map((policy) => (
          <article key={policy.id}>
            <span className="policy-shield">
              <ShieldCheck size={19} />
            </span>
            <div>
              <h2>{policy.name}</h2>
              <p>{policy.description}</p>
              <small>
                Owner: {policy.owner} · {policy.detector.type.replaceAll("_", " ")}
              </small>
            </div>
            <SeverityLabel severity={policy.severity} />
            <span className={policy.enabled ? "toggle is-on" : "toggle"}>
              <i />
            </span>
            <ChevronRight size={17} />
          </article>
        ))}
      </div>
      {open && (
        <Modal
          title="Create an explicit policy"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" form="create-policy">
                Create policy
              </Button>
            </>
          }
        >
          <form id="create-policy" className="form-stack" onSubmit={(event) => void submit(event)}>
            <FormField label="Policy name">
              <input
                name="policyName"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <FormField label="Description and violation message">
              <textarea
                name="policyDescription"
                required
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </FormField>
            <FormField
              label="Forbidden pattern"
              hint="Trusted configuration; use a bounded regular expression."
            >
              <input
                name="policyPattern"
                required
                value={pattern}
                onChange={(event) => setPattern(event.target.value)}
                placeholder="authorization\\s*[:=]"
              />
            </FormField>
            <div className="warning-callout">
              <AlertTriangle size={18} />
              Blocker policies fail verification and CI. Confirm the scope and detector carefully.
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function SessionsPage({ data }: { data: DashboardSnapshot }) {
  return (
    <div className="page-pad">
      <PageHeader
        title="Agent sessions"
        description="See the context Lore prepared, files an agent touched, and verification state."
        actions={
          <Button variant="primary" icon={<TerminalSquare size={16} />}>
            Start with CLI
          </Button>
        }
      />
      <div className="session-list">
        {data.sessions.map((session) => (
          <article key={session.id}>
            <span className={`session-status session-status--${session.status}`}>
              <Code2 size={18} />
            </span>
            <div>
              <h2>{session.task}</h2>
              <p>
                {session.agentType} · {session.status} · started {relativeTime(session.startedAt)}
              </p>
            </div>
            <div>
              <span>Changed files</span>
              <strong>{session.filesChanged.length}</strong>
            </div>
            <div>
              <span>Warnings</span>
              <strong>{session.warningCount}</strong>
            </div>
            <Button variant="secondary">Open session</Button>
            <ChevronRight size={17} />
          </article>
        ))}
      </div>
      <div className="cli-callout">
        <TerminalSquare size={22} />
        <div>
          <strong>Mandatory context lives around the agent</strong>
          <p>
            Run <code>lore agent codex "your task"</code>. Lore prepares context, watches new files,
            refreshes constraints, and verifies the final diff.
          </p>
        </div>
        <Button variant="secondary" icon={<Copy size={15} />}>
          Copy command
        </Button>
      </div>
    </div>
  );
}

const jobName = (value: JobRunRecord["name"]): string => ({
  "repository.index": "Repository indexing",
  "github.import": "GitHub evidence import",
  "knowledge.extract": "AI candidate extraction",
  "knowledge.health": "Knowledge health review"
})[value];

const jobProgressMessage = (job: JobRunRecord): string | undefined =>
  job.events?.toReversed().find((event) => event.message?.startsWith("GitHub "))?.message;

export function JobsPage() {
  const [jobs, setJobs] = useState<JobRunRecord[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (): Promise<void> => {
      try {
        const response = await loreApi.jobs();
        if (active) { setJobs(response.items); setError(undefined); setLoading(false); }
      } catch (cause) {
        if (active) { setError(cause instanceof Error ? cause.message : "Background activity is unavailable"); setLoading(false); }
      } finally {
        if (active) timer = setTimeout(() => void load(), 5_000);
      }
    };
    void load();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, []);

  return (
    <div className="page-pad">
      <PageHeader
        title="Background activity"
        description="Durable imports, indexing, AI extraction, retries, and terminal outcomes. This view refreshes every five seconds."
      />
      {error && <div className="form-error">{error}</div>}
      {loading ? (
        <EmptyState title="Loading background activity" body="Reading durable job state from PostgreSQL." />
      ) : jobs.length === 0 ? (
        <EmptyState title="No background activity yet" body="Connect a repository or start an import. Lore will retain its dispatch and worker lifecycle here." />
      ) : (
        <div className="session-list job-list">
          {jobs.map((job) => (
            <article key={job.id}>
              <span className={`session-status job-status--${job.state}`}>
                {job.state === "running" || job.state === "retrying" ? <LoaderCircle size={18} /> : <History size={18} />}
              </span>
              <div>
                <h2>{jobName(job.name)}</h2>
                <p>{job.state.replace("_", " ")} · queued {relativeTime(job.queuedAt)}</p>
                {job.errorMessage && <small>{job.errorMessage}</small>}
                {!job.errorMessage && jobProgressMessage(job) && <small className="job-progress">{jobProgressMessage(job)}</small>}
              </div>
              <div><span>Attempt</span><strong>{job.attempt}/{job.maximumAttempts}</strong></div>
              <div><span>Events</span><strong>{job.events?.length ?? 0}</strong></div>
              <div className={`job-state job-state--${job.state}`}>{job.state.replace("_", " ")}</div>
              <ChevronRight size={17} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReportsPage({ reports }: { reports: SafetyReport[] }) {
  const [selected, setSelected] = useState(reports[0]);
  return (
    <div className="page-pad reports-page">
      <PageHeader
        title="Safety reports"
        description="Evidence-backed impact and policy checks, explained in developer language."
      />
      <div className="reports-workspace">
        <aside>
          {reports.map((report) => (
            <button
              key={report.id}
              className={selected?.id === report.id ? "is-selected" : ""}
              onClick={() => setSelected(report)}
            >
              <span>
                <strong>{report.task}</strong>
                <small>
                  {report.repositoryName} · {relativeTime(report.createdAt)}
                </small>
              </span>
              <Risk level={report.risk} />
            </button>
          ))}
        </aside>
        {selected ? (
          <main className="report-detail">
            <header>
              <div>
                <span>Overall risk</span>
                <h2>{selected.risk}</h2>
                <p>{selected.riskReasons.join(" · ")}</p>
              </div>
              <div>
                <strong>{selected.evidenceCount}</strong>
                <span>evidence sources</span>
              </div>
            </header>
            <ReportSection icon={<GitBranch />} title="Changed code">
              {selected.changedFiles.map((file) => (
                <p key={file.path}>
                  <code>{file.path}</code>
                  <span>
                    +{file.additions} / −{file.deletions}
                  </span>
                </p>
              ))}
            </ReportSection>
            <ReportSection icon={<Link2 />} title="Potential impact">
              {selected.affectedCode.map((item) => (
                <p key={item.name}>
                  <strong>{item.name}</strong>
                  <span>
                    {item.reason} · {Math.round(item.confidence * 100)}%
                  </span>
                </p>
              ))}
            </ReportSection>
            <ReportSection icon={<ShieldCheck />} title="Rules & policies">
              {[
                ...selected.applicablePolicies.map((item) => ({
                  id: item.id,
                  title: item.name,
                  body: item.description
                })),
                ...selected.applicableRules.map((item) => ({
                  id: item.id,
                  title: item.title,
                  body: item.statement
                }))
              ].map((item) => (
                <p key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </p>
              ))}
            </ReportSection>
            {selected.historicalRegressions.length > 0 && (
              <div className="regression-callout">
                <History size={19} />
                <div>
                  <strong>Historical regression</strong>
                  {selected.historicalRegressions.map((item) => (
                    <p key={item.id}>
                      {item.title}: {item.description}
                    </p>
                  ))}
                </div>
              </div>
            )}
            <ReportSection icon={<CheckCircle2 />} title="Tests">
              {selected.testsRecommended.map((test) => (
                <p key={test.path}>
                  <strong>{test.path}</strong>
                  <span>{test.reason}</span>
                </p>
              ))}
            </ReportSection>
            {selected.blockers.length > 0 && (
              <div className="blocker-callout">
                <AlertTriangle size={20} />
                <div>
                  <strong>Completion blocked</strong>
                  {selected.blockers.map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </div>
              </div>
            )}
          </main>
        ) : (
          <EmptyState title="No report selected" body="Choose a report to inspect its evidence." />
        )}
      </div>
    </div>
  );
}

function ReportSection({
  icon,
  title,
  children
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="report-section">
      <h3>
        {icon}
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
}

export function ReviewersPage({ data }: { data: DashboardSnapshot }) {
  return (
    <div className="page-pad">
      <PageHeader
        title="Reviewer intelligence"
        description="Scoped tendencies observed from explicit review feedback—not organisation-wide rules."
      />
      <div className="reviewer-grid">
        {data.reviewers.map((reviewer) => {
          const preferences = data.knowledge.filter(
            (item) => item.kind === "preference" && item.scope.reviewer === reviewer.email
          );
          return (
            <article key={reviewer.id}>
              <div className="reviewer-avatar">
                {reviewer.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")}
              </div>
              <h2>{reviewer.name}</h2>
              <p>@{reviewer.providerIdentity}</p>
              <dl>
                <div>
                  <dt>Preferences</dt>
                  <dd>{reviewer.preferenceCount}</dd>
                </div>
                <div>
                  <dt>Reinforced</dt>
                  <dd>{reviewer.reinforcedCount}</dd>
                </div>
              </dl>
              <div className="reviewer-preferences">
                {preferences.map((item) => (
                  <p key={item.id}>
                    <Sparkles size={14} />
                    {item.statement}
                  </p>
                ))}
                {!preferences.length && (
                  <p>No active preference has crossed the evidence threshold.</p>
                )}
              </div>
              <small>Last observed {relativeTime(reviewer.lastObservedAt)}</small>
            </article>
          );
        })}
      </div>
      <div className="info-callout reviewer-note">
        <CircleHelp size={19} />
        <span>
          <strong>Preferences stay advisory</strong> Repeated feedback from one reviewer stays
          scoped to that reviewer until broader evidence and a human decision promote it.
        </span>
      </div>
    </div>
  );
}

export function SettingsPage({
  canManageOrganisation,
  onUserSettingsChanged
}: {
  canManageOrganisation: boolean;
  onUserSettingsChanged?: (settings: SettingsBundle["user"]) => void;
}) {
  const [settings, setSettings] = useState<SettingsBundle>();
  const [userDraft, setUserDraft] = useState<SettingsBundle["user"]>();
  const [organisationDraft, setOrganisationDraft] = useState<SettingsBundle["organisation"]>();
  const [copied, setCopied] = useState<string>();
  const [saving, setSaving] = useState<string>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [tokenName, setTokenName] = useState("Local MCP");
  const [tokenExpiry, setTokenExpiry] = useState<30 | 90 | 365>(90);
  const [revealedToken, setRevealedToken] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void loreApi.settings().then((loaded) => {
      if (cancelled) return;
      setSettings(loaded);
      setUserDraft(structuredClone(loaded.user));
      setOrganisationDraft(structuredClone(loaded.organisation));
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Settings could not be loaded");
    });
    return () => { cancelled = true; };
  }, []);

  const copy = (id: string, value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(id);
    window.setTimeout(() => setCopied(undefined), 1500);
  };
  const snippets = [
    ["Start Lore", "npm run local:up"],
    ["Connect checkout", "node /Users/dev/Lore/dist/cli.js connect OWNER/REPOSITORY"],
    ["Index checkout", "node /Users/dev/Lore/dist/cli.js index"],
    ["Check MCP", "npm run mcp:check -- /absolute/path/to/checkout"],
  ];

  const saveUser = async (): Promise<void> => {
    if (!userDraft) return;
    setSaving("user"); setError(undefined); setMessage(undefined);
    try {
      const saved = await loreApi.updateUserSettings(userDraft);
      setUserDraft(saved);
      setSettings((current) => current ? { ...current, user: saved } : current);
      onUserSettingsChanged?.(saved);
      setMessage("Your preferences were saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Personal settings could not be saved");
    } finally { setSaving(undefined); }
  };

  const saveOrganisation = async (): Promise<void> => {
    if (!organisationDraft) return;
    setSaving("organisation"); setError(undefined); setMessage(undefined);
    try {
      const saved = await loreApi.updateOrganisationSettings(organisationDraft);
      setOrganisationDraft(saved);
      setSettings((current) => current ? { ...current, organisation: saved } : current);
      setMessage("Organisation defaults were saved and apply only to this organisation.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Organisation settings could not be saved");
    } finally { setSaving(undefined); }
  };

  const createToken = async (): Promise<void> => {
    setSaving("token"); setError(undefined); setMessage(undefined);
    try {
      const created = await loreApi.createApiToken({ name: tokenName, expiresInDays: tokenExpiry });
      setRevealedToken(created.token);
      setSettings((current) => current ? { ...current, apiTokens: [created.item, ...current.apiTokens] } : current);
      setMessage("Token created. Copy it now; Lore will not show the full value again.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Token could not be created");
    } finally { setSaving(undefined); }
  };

  const revokeToken = async (id: string): Promise<void> => {
    setSaving(`token-${id}`); setError(undefined); setMessage(undefined);
    try {
      await loreApi.revokeApiToken(id);
      setSettings((current) => current ? { ...current, apiTokens: current.apiTokens.filter((item) => item.id !== id) } : current);
      setMessage("Token revoked.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Token could not be revoked");
    } finally { setSaving(undefined); }
  };

  if (!settings || !userDraft || !organisationDraft) {
    return (
      <div className="page-pad settings-page">
        <PageHeader title="Settings & setup" description="Loading your installation and organisation settings…" />
        {error ? <p className="form-error">{error}</p> : <div className="loading-line" />}
      </div>
    );
  }

  const deployment = settings.deployment;
  return (
    <div className="page-pad settings-page">
      <PageHeader
        title="Settings & setup"
        description="Configure your account, this organisation, GitHub automation, AI, and MCP access."
      />
      {error && <p className="form-error">{error}</p>}
      {message && <p className="settings-success"><CheckCircle2 size={15} /> {message}</p>}
      <section>
        <h2>This installation</h2>
        <p>
          Local and SaaS are deployment choices, not feature tiers. A local full installation still
          has real accounts, private organisations, GitHub ingestion, AI extraction, and MCP.
        </p>
        <div className="runtime-grid">
          <div><span>Deployment</span><strong>{deployment.deploymentMode === "local" ? "Local, loopback-first" : "Shared SaaS"}</strong></div>
          <div><span>Product mode</span><strong>{deployment.productMode === "full" ? "Full product" : "Seeded demo"}</strong></div>
          <div><span>Persistence</span><strong>{deployment.persistence === "postgresql" ? "PostgreSQL" : "In-memory"}</strong></div>
          <div><span>Jobs</span><strong>{deployment.jobs === "redis" ? "Redis worker" : "In-process"}</strong></div>
          <div><span>GitHub history</span><strong>{deployment.github.historicalImportReady ? `${deployment.github.mode} ready` : "Needs credentials"}</strong></div>
          <div><span>AI extraction</span><strong>{deployment.ai.configured ? `${deployment.ai.provider} · ${deployment.ai.model ?? "configured"}` : "Needs configuration"}</strong></div>
          <div>
            <span>{deployment.deploymentMode === "local" ? "Local identity" : "GitHub login"}</span>
            <strong>{deployment.deploymentMode === "local"
              ? deployment.productMode === "demo"
                ? "Demo account"
                : deployment.github.historicalImportReady ? "PAT auto-sign-in" : "Needs GITHUB_TOKEN"
              : deployment.login.configured ? "OAuth ready" : "Needs OAuth app"}</strong>
          </div>
          <div><span>MCP</span><strong>{deployment.mcp.serviceBacked ? "Service-backed stdio" : "Local/demo stdio"}</strong></div>
        </div>
      </section>
      <section>
        <div className="settings-section-title">
          <div><h2>Your preferences</h2><p>These follow your GitHub account across every organisation.</p></div>
          <Button variant="primary" disabled={saving === "user"} onClick={() => void saveUser()}>{saving === "user" ? "Saving…" : "Save preferences"}</Button>
        </div>
        <div className="settings-form-grid">
          <label className="form-field" htmlFor="settings-start-page"><span>Start page</span><select id="settings-start-page" name="startPage" value={userDraft.startPage} onChange={(event) => setUserDraft({ ...userDraft, startPage: event.target.value as typeof userDraft.startPage })}><option value="dashboard">Dashboard</option><option value="repositories">Repositories</option><option value="knowledge">Knowledge</option><option value="evidence">Add evidence</option><option value="candidates">Candidates</option><option value="sessions">Sessions</option></select></label>
          <label className="form-field" htmlFor="settings-default-import"><span>Default history import</span><select id="settings-default-import" name="defaultImportLimit" value={String(userDraft.defaultImportLimit)} onChange={(event) => setUserDraft({ ...userDraft, defaultImportLimit: event.target.value === "all" ? "all" : Number(event.target.value) as PullRequestImportLimit })}>{[50,100,250,500,1000].map((limit) => <option key={limit} value={limit}>{limit} merged PRs</option>)}<option value="all">All merged PRs</option></select></label>
          <label className="form-field" htmlFor="settings-theme"><span>Theme</span><select id="settings-theme" name="theme" value={userDraft.theme} onChange={(event) => setUserDraft({ ...userDraft, theme: event.target.value as typeof userDraft.theme })}><option value="system">Use system</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        </div>
        <div className="settings-checks">
          <label><input type="checkbox" checked={userDraft.showGettingStarted} onChange={(event) => setUserDraft({ ...userDraft, showGettingStarted: event.target.checked })} /><span><strong>Show onboarding guidance</strong><small>Keep the repository setup checklist visible.</small></span></label>
          <label><input type="checkbox" checked={userDraft.notifyImportCompleted} onChange={(event) => setUserDraft({ ...userDraft, notifyImportCompleted: event.target.checked })} /><span><strong>Import completion notices</strong><small>Show an in-app notice when a history import is queued.</small></span></label>
          <label><input type="checkbox" checked={userDraft.notifyCandidateReview} onChange={(event) => setUserDraft({ ...userDraft, notifyCandidateReview: event.target.checked })} /><span><strong>Candidate review notices</strong><small>Highlight knowledge suggestions awaiting human review.</small></span></label>
        </div>
      </section>
      <section>
        <div className="settings-section-title">
          <div><h2>Organisation defaults</h2><p>These apply only to the active organisation. Owner or admin access is required.</p></div>
          <Button variant="primary" disabled={!canManageOrganisation || saving === "organisation"} onClick={() => void saveOrganisation()}>{saving === "organisation" ? "Saving…" : "Save organisation"}</Button>
        </div>
        {!canManageOrganisation && <p className="warning-callout"><AlertTriangle size={15} /> Your role can view these defaults but cannot change them.</p>}
        <fieldset className="settings-fieldset" disabled={!canManageOrganisation}>
          <div className="settings-form-grid">
            <label className="form-field" htmlFor="settings-initial-import"><span>Initial history import</span><select id="settings-initial-import" name="githubImportLimit" value={String(organisationDraft.githubImportLimit)} onChange={(event) => setOrganisationDraft({ ...organisationDraft, githubImportLimit: event.target.value === "all" ? "all" : Number(event.target.value) as PullRequestImportLimit })}>{[50,100,250,500,1000].map((limit) => <option key={limit} value={limit}>{limit} merged PRs</option>)}<option value="all">All merged PRs</option></select><small>“All” paginates every merged PR the token can access.</small></label>
            <label className="form-field" htmlFor="settings-sync-interval"><span>Sync interval</span><select id="settings-sync-interval" name="githubSyncIntervalMinutes" value={organisationDraft.githubSyncIntervalMinutes} onChange={(event) => setOrganisationDraft({ ...organisationDraft, githubSyncIntervalMinutes: Number(event.target.value) })}><option value={15}>Every 15 minutes</option><option value={30}>Every 30 minutes</option><option value={60}>Hourly</option><option value={360}>Every 6 hours</option><option value={1440}>Daily</option></select><small>Recurring sync fetches the latest 100 merged PRs and only extracts new evidence.</small></label>
          </div>
          <div className="settings-checks">
            {([
              ["autoImportGitHub", "Automatically import GitHub history", "Import immediately on connect and schedule recurring sync."],
              ["autoExtractKnowledge", "Automatically extract candidates", "Use the configured AI provider on newly gathered evidence."],
              ["communicationEvidenceEnabled", "Allow ad-hoc communications", "Parse standups, Slack messages, meetings, calls, and notes."],
              ["memberCanConnectRepositories", "Members can connect repositories", "Allow members as well as admins to add repository metadata."],
              ["mcpAccessEnabled", "Allow MCP and CLI access", "Permit organisation-scoped API tokens to use service-backed agent tools."]
            ] as const).map(([key, title, description]) => <label key={key}><input type="checkbox" checked={organisationDraft[key]} onChange={(event) => setOrganisationDraft({ ...organisationDraft, [key]: event.target.checked })} /><span><strong>{title}</strong><small>{description}</small></span></label>)}
          </div>
          <h3>Evidence retention for newly connected repositories</h3>
          <div className="settings-checks settings-checks--retention">
            {([
              ["retainReviewComments", "Review comments", "Keep review, conversation, and inline comments."],
              ["retainRawPullRequestDiff", "Raw pull request diffs", "Higher sensitivity: retain complete PR diffs."],
              ["retainCodeSnippets", "Code snippets", "Retain extracted source snippets where supported."],
              ["retainSummariesOnly", "Summary-only mode", "Keep titles and metadata; incompatible with raw diffs/snippets."]
            ] as const).map(([key, title, description]) => <label key={key}><input type="checkbox" checked={organisationDraft.repositoryRetention[key]} onChange={(event) => setOrganisationDraft({ ...organisationDraft, repositoryRetention: { ...organisationDraft.repositoryRetention, [key]: event.target.checked } })} /><span><strong>{title}</strong><small>{description}</small></span></label>)}
          </div>
        </fieldset>
      </section>
      <section>
        <h2>Agent & MCP access</h2>
        {deployment.deploymentMode === "local" ? (
          <div className="info-callout"><TerminalSquare size={18} /><span><strong>No extra local token is needed</strong> Connect a checkout with <code>node /Users/dev/Lore/dist/cli.js connect OWNER/REPOSITORY</code>. Lore discovers the active local organisation and repository, and MCP reuses the loopback-only service.</span></div>
        ) : <p>Create a token for this user and active organisation. Store it in a mode-600 file outside any repository.</p>}
        {deployment.deploymentMode === "saas" && <><div className="token-create">
          <label className="form-field" htmlFor="settings-token-name"><span>Token name</span><input id="settings-token-name" name="tokenName" value={tokenName} minLength={3} maxLength={100} onChange={(event) => setTokenName(event.target.value)} /></label>
          <label className="form-field" htmlFor="settings-token-expiry"><span>Expires</span><select id="settings-token-expiry" name="tokenExpiry" value={tokenExpiry} onChange={(event) => setTokenExpiry(Number(event.target.value) as 30 | 90 | 365)}><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option></select></label>
          <Button variant="primary" disabled={tokenName.trim().length < 3 || saving === "token"} onClick={() => void createToken()}>{saving === "token" ? "Creating…" : "Create token"}</Button>
        </div>
        {revealedToken && <div className="token-reveal"><strong>Copy this token now</strong><code>{revealedToken}</code><button aria-label="Copy token" onClick={() => copy("token", revealedToken)}>{copied === "token" ? <Check size={15} /> : <Copy size={15} />}</button><small>Suggested file: <code>~/.config/lore/token</code>, then run <code>chmod 600 ~/.config/lore/token</code>.</small></div>}
        <div className="token-list">
          {settings.apiTokens.map((token) => <div key={token.id}><span><strong>{token.name}</strong><small>{token.prefix}… · expires {token.expiresAt ? formatDate(token.expiresAt) : "never"}</small></span><Button variant="quiet" disabled={saving === `token-${token.id}`} onClick={() => void revokeToken(token.id)}>Revoke</Button></div>)}
          {!settings.apiTokens.length && <p>No active agent tokens for this organisation.</p>}
        </div></>}
      </section>
      <section>
        <h2>{deployment.deploymentMode === "local" ? "Local GitHub setup" : "SaaS GitHub setup"}</h2>
        {deployment.deploymentMode === "local" ? (
          <>
            <p>Local Lore uses one personal access token for your profile, accessible-repository picker, and pull-request evidence. No callback or GitHub App is required.</p>
            <div className="credential-grid credential-grid--single"><div><strong>Only required GitHub setting</strong><code>GITHUB_TOKEN=github_pat_…</code><small>A classic PAT with <code>repo</code> can see every repository your account can access; a fine-grained token shows only its selected owner and repositories. Organisation policy or SAML SSO can further limit either token.</small></div></div>
          </>
        ) : (
          <>
            <p>Shared SaaS deployments use OAuth for user identity and a GitHub App for least-privilege repository installations, webhooks, and multi-user operation.</p>
            <div className="credential-grid"><div><strong>User identity</strong><code>GITHUB_OAUTH_CLIENT_ID</code><code>GITHUB_OAUTH_CLIENT_SECRET</code></div><div><strong>Repository installation</strong><code>GITHUB_APP_ID</code><code>GITHUB_PRIVATE_KEY</code><code>GITHUB_WEBHOOK_SECRET</code></div></div>
          </>
        )}
      </section>
      <section><h2>Quick commands</h2><p>Copy-ready commands for a full local installation and service-backed MCP.</p><div className="snippet-list">{snippets.map(([name, command]) => <div key={name}><span>{name}</span><code>{command}</code><button onClick={() => copy(name!, command!)}>{copied === name ? <Check size={15} /> : <Copy size={15} />}</button></div>)}</div></section>
      <section><h2>Documentation</h2><p>Detailed, versioned guides live with the implementation.</p><div className="docs-links"><button onClick={() => copy("readme", "README.md")}><BookOpen size={17} /><span>README &amp; setup<small>README.md</small></span>{copied === "readme" ? <Check size={14} /> : <Copy size={14} />}</button><button onClick={() => copy("mcp-doc", "docs/mcp.md")}><Braces size={17} /><span>MCP setup &amp; prompt<small>docs/mcp.md</small></span>{copied === "mcp-doc" ? <Check size={14} /> : <Copy size={14} />}</button></div></section>
    </div>
  );
}
