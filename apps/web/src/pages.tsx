import { useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Braces,
  Check,
  CheckCircle2,
  ChevronLeft,
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
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  UserRoundCheck
} from "lucide-react";
import type {
  AgentSession,
  CandidateBulkReviewResult,
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
  ReviewerProfile,
  RepositoryRetentionConfig,
  RepositorySummary,
  SafetyReport,
  SessionEvent,
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
  ReviewerAvatar,
  Risk,
  SeverityLabel
} from "./components.js";
import { parseGitHubRepositoryReference } from "./github-repository.js";
import {
  loreApi,
  type GitHubRepositoryOption,
  type RepositoryBatchConnectionResult
} from "./api.js";
import { createEvidencePreview } from "./evidence-preview.js";

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

const reviewerKey = (value: string): string => value.trim().replace(/^@/, "").toLowerCase();

const findReviewer = (
  reviewers: ReviewerProfile[],
  identity?: string
): ReviewerProfile | undefined => {
  if (!identity) return undefined;
  const key = reviewerKey(identity);
  return reviewers.find(
    (reviewer) =>
      reviewerKey(reviewer.providerIdentity) === key ||
      (reviewer.email ? reviewerKey(reviewer.email) === key : false)
  );
};

function ReviewerAwareKindIcon({
  item,
  reviewers
}: {
  item: Pick<KnowledgeItem, "kind" | "scope">;
  reviewers: ReviewerProfile[];
}) {
  const reviewer =
    item.kind === "preference" ? findReviewer(reviewers, item.scope.reviewer) : undefined;
  return reviewer ? (
    <ReviewerAvatar reviewer={reviewer} size="small" />
  ) : (
    <KindIcon kind={item.kind} />
  );
}

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
  reviewers,
  onAnalyse,
  onList,
  onReview
}: {
  repositories: RepositorySummary[];
  reviewers: ReviewerProfile[];
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
          <strong>Private by design in this local installation.</strong> Lore stores the original text for provenance, treats it as untrusted input, and never activates extracted knowledge without human review. Remove secrets, payment data, and unnecessary customer information before pasting.
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
                <ReviewerAwareKindIcon item={item.candidate} reviewers={reviewers} />
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
  const [task, setTask] = useState("Separate origin and destination tax address codes");
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
                  <ReviewerAwareKindIcon item={candidate} reviewers={data.reviewers} />
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
  reviewers,
  onApprove,
  onReject,
  onMerge,
  onTriage,
  onBulkReview,
  onLoadCandidate
}: {
  candidates: CandidateRecord[];
  knowledge: KnowledgeItem[];
  reviewers: ReviewerProfile[];
  onApprove: (
    candidate: CandidateRecord,
    draft: Pick<CandidateRecord, "statement" | "kind" | "scope">
  ) => Promise<void>;
  onReject: (candidate: CandidateRecord) => Promise<void>;
  onMerge: (candidate: CandidateRecord, targetId: string) => Promise<void>;
  onTriage: (candidateIds?: string[], force?: boolean) => Promise<void>;
  onBulkReview: (
    action: "approve" | "ignore",
    candidateIds: string[]
  ) => Promise<CandidateBulkReviewResult>;
  onLoadCandidate: (candidateId: string) => Promise<CandidateRecord>;
}) {
  const pageSize = 60;
  const [selectedId, setSelectedId] = useState(candidates[0]?.id);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [triageFilter, setTriageFilter] = useState("all");
  const [repositoryFilter, setRepositoryFilter] = useState("all");
  const [sort, setSort] = useState("priority");
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [statement, setStatement] = useState(candidates[0]?.statement ?? "");
  const [draftKind, setDraftKind] = useState<KnowledgeKind>(candidates[0]?.kind ?? "rule");
  const [draftScope, setDraftScope] = useState<KnowledgeScope>(candidates[0]?.scope ?? {});
  const [scopeOpen, setScopeOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);
  const [forceTriage, setForceTriage] = useState(false);
  const [bulkAction, setBulkAction] = useState<"approve" | "ignore">();
  const [loadedCandidate, setLoadedCandidate] = useState<CandidateRecord>();
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [working, setWorking] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const repositories = useMemo(
    () =>
      [...new Set(candidates.map((candidate) => candidate.scope.repository).filter(Boolean))]
        .toSorted() as string[],
    [candidates]
  );
  const triageCounts = useMemo(
    () => ({
      untriaged: candidates.filter((candidate) => !candidate.triage).length,
      approve: candidates.filter((candidate) => candidate.triage?.bulkEligibleAction === "approve").length,
      ignore: candidates.filter((candidate) => candidate.triage?.bulkEligibleAction === "ignore").length,
      review: candidates.filter(
        (candidate) =>
          candidate.triage &&
          !candidate.triage.bulkEligibleAction
      ).length,
      policy: candidates.filter((candidate) => candidate.triage?.policyFit === "possible_policy").length
    }),
    [candidates]
  );
  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    const result = candidates.filter((candidate) => {
      const triageMatch =
        triageFilter === "all" ||
        (triageFilter === "untriaged" && !candidate.triage) ||
        (triageFilter === "bulk_approve" && candidate.triage?.bulkEligibleAction === "approve") ||
        (triageFilter === "bulk_ignore" && candidate.triage?.bulkEligibleAction === "ignore") ||
        (triageFilter === "policy" && candidate.triage?.policyFit === "possible_policy") ||
        candidate.triage?.action === triageFilter;
      return (
        (filter === "all" || candidate.kind === filter) &&
        (repositoryFilter === "all" || candidate.scope.repository === repositoryFilter) &&
        triageMatch &&
        (!needle ||
          `${candidate.title} ${candidate.statement} ${candidate.rationale}`
            .toLowerCase()
            .includes(needle))
      );
    });
    return result.toSorted((left, right) => {
      if (sort === "newest") return right.updatedAt.localeCompare(left.updatedAt);
      if (sort === "confidence") return right.confidence - left.confidence;
      const priority = (candidate: CandidateRecord): number => {
        if (!candidate.triage) return 0;
        if (candidate.triage.policyFit === "possible_policy") return 1;
        if (candidate.triage.action === "review" || candidate.triage.action === "edit") return 2;
        if (candidate.triage.action === "merge") return 3;
        if (candidate.triage.bulkEligibleAction === "approve") return 4;
        if (candidate.triage.bulkEligibleAction === "ignore") return 5;
        return 6;
      };
      return priority(left) - priority(right) || right.confidence - left.confidence;
    });
  }, [candidates, deferredQuery, filter, repositoryFilter, sort, triageFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selectedSummary =
    filtered.find((candidate) => candidate.id === selectedId) ?? filtered[0];
  const selected: CandidateRecord | undefined =
    selectedSummary && loadedCandidate?.id === selectedSummary.id
      ? { ...loadedCandidate, ...selectedSummary, evidence: loadedCandidate.evidence }
      : selectedSummary;
  const selectedCandidates = candidates.filter((candidate) => selectedIds.has(candidate.id));
  const bulkApproveIds = selectedCandidates.map((candidate) => candidate.id);
  const bulkIgnoreIds = selectedCandidates
    .filter((candidate) => candidate.triage?.bulkEligibleAction === "ignore")
    .map((candidate) => candidate.id);
  const bulkActionIds = bulkAction === "approve" ? bulkApproveIds : bulkIgnoreIds;
  const triageTargetIds = (
    selectedIds.size ? selectedCandidates : filtered
  )
    .filter((candidate) => forceTriage || !candidate.triage)
    .map((candidate) => candidate.id);
  const mergeTargets = [
    ...knowledge.filter((item) => item.status !== "rejected" && item.status !== "archived"),
    ...candidates.filter((item) => item.id !== selected?.id)
  ];

  useEffect(() => {
    if (!selected) return;
    setStatement(selected.statement);
    setDraftKind(selected.kind);
    setDraftScope(selected.scope);
    detailScrollRef.current?.scrollTo({ top: 0 });
  }, [selected?.id]);

  useEffect(() => {
    if (!selectedSummary) {
      setLoadedCandidate(undefined);
      return;
    }
    let active = true;
    setLoadedCandidate(undefined);
    void onLoadCandidate(selectedSummary.id)
      .then((candidate) => {
        if (active) setLoadedCandidate(candidate);
      })
      .catch(() => {
        // The bounded list preview remains usable if a detail refresh is interrupted.
      });
    return () => {
      active = false;
    };
  }, [onLoadCandidate, selectedSummary?.id, selectedSummary?.updatedAt]);

  useEffect(() => {
    setPage(1);
  }, [deferredQuery, filter, repositoryFilter, sort, triageFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    const available = new Set(candidates.map((candidate) => candidate.id));
    setSelectedIds((current) => new Set([...current].filter((id) => available.has(id))));
  }, [candidates]);

  const select = (candidate: CandidateRecord): void => {
    setSelectedId(candidate.id);
    setStatement(candidate.statement);
    setDraftKind(candidate.kind);
    setDraftScope(candidate.scope);
    if (window.matchMedia("(max-width: 900px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "start" }));
    } else {
      detailScrollRef.current?.scrollTo({ top: 0 });
    }
  };

  const toggleCandidate = (candidateId: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  };

  const allVisibleSelected =
    visible.length > 0 && visible.every((candidate) => selectedIds.has(candidate.id));
  const toggleVisible = (): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const candidate of visible) {
        if (allVisibleSelected) next.delete(candidate.id);
        else next.add(candidate.id);
      }
      return next;
    });
  };

  const triageActionLabel = (candidate: CandidateRecord): string => {
    if (!candidate.triage) return "Not analysed";
    if (candidate.triage.policyFit === "possible_policy") return "Policy review";
    return {
      approve: "Ready to add",
      edit: "Edit first",
      merge: "Merge duplicate",
      ignore: "Likely noise",
      review: "Needs review"
    }[candidate.triage.action];
  };

  return (
    <div className="candidate-page">
      <PageHeader
        title="Review what Lore learned"
        description="Let AI sort the backlog, then make fast, evidence-backed human decisions."
        actions={
          <>
            <span className="header-meta">{candidates.length} pending</span>
            <Button
              variant="primary"
              icon={<Sparkles size={15} />}
              onClick={() => {
                setForceTriage(false);
                setTriageOpen(true);
              }}
            >
              Triage with AI
            </Button>
          </>
        }
      />
      <section className="candidate-triage-summary" aria-label="Candidate triage summary">
        <button
          className={triageFilter === "untriaged" ? "is-active" : ""}
          onClick={() => setTriageFilter("untriaged")}
        >
          <span>Not analysed</span>
          <strong>{triageCounts.untriaged}</strong>
          <small>Send through triage</small>
        </button>
        <button
          className={triageFilter === "bulk_approve" ? "is-active" : ""}
          onClick={() => setTriageFilter("bulk_approve")}
        >
          <span>Ready to add</span>
          <strong>{triageCounts.approve}</strong>
          <small>Guarded bulk approval</small>
        </button>
        <button
          className={triageFilter === "bulk_ignore" ? "is-active" : ""}
          onClick={() => setTriageFilter("bulk_ignore")}
        >
          <span>Likely noise</span>
          <strong>{triageCounts.ignore}</strong>
          <small>One-off commit activity</small>
        </button>
        <button
          className={triageFilter === "review" ? "is-active" : ""}
          onClick={() => setTriageFilter("review")}
        >
          <span>Human review</span>
          <strong>{triageCounts.review}</strong>
          <small>Edit, merge, or inspect</small>
        </button>
        <button
          className={triageFilter === "policy" ? "is-active" : ""}
          onClick={() => setTriageFilter("policy")}
        >
          <span>Possible policy</span>
          <strong>{triageCounts.policy}</strong>
          <small>Never auto-created</small>
        </button>
      </section>
      <div className="candidate-bulk-bar">
        <label>
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleVisible}
          />
          Select this page
        </label>
        <span>{selectedIds.size ? `${selectedIds.size} selected` : "Select candidates to act in batches"}</span>
        {selectedIds.size > 0 && (
          <Button variant="secondary" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={!selectedIds.size}
          icon={<Sparkles size={14} />}
          onClick={() => {
            setForceTriage(false);
            setTriageOpen(true);
          }}
        >
          Analyse selection
        </Button>
        <Button
          variant="secondary"
          disabled={!bulkIgnoreIds.length}
          onClick={() => setBulkAction("ignore")}
        >
          Ignore {bulkIgnoreIds.length || ""}
        </Button>
        <Button
          variant="primary"
          disabled={!bulkApproveIds.length}
          onClick={() => setBulkAction("approve")}
        >
          Add {bulkApproveIds.length || ""} to knowledge
        </Button>
      </div>
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
            <button
              aria-label="Candidate filters"
              className={filterOpen ? "is-active" : ""}
              onClick={() => setFilterOpen((value) => !value)}
            >
              <Filter size={17} />
            </button>
          </div>
          {filterOpen && (
            <div className="candidate-filter-panel">
              <label>
                <span>Recommendation</span>
                <select value={triageFilter} onChange={(event) => setTriageFilter(event.target.value)}>
                  <option value="all">All recommendations</option>
                  <option value="untriaged">Not analysed</option>
                  <option value="bulk_approve">Ready to add</option>
                  <option value="bulk_ignore">Likely noise</option>
                  <option value="edit">Edit first</option>
                  <option value="merge">Merge duplicate</option>
                  <option value="review">Needs review</option>
                  <option value="policy">Possible policy</option>
                </select>
              </label>
              <label>
                <span>Repository</span>
                <select value={repositoryFilter} onChange={(event) => setRepositoryFilter(event.target.value)}>
                  <option value="all">All repositories</option>
                  {repositories.map((repository) => (
                    <option value={repository} key={repository}>{repository}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Sort</span>
                <select value={sort} onChange={(event) => setSort(event.target.value)}>
                  <option value="priority">Review priority</option>
                  <option value="confidence">Confidence</option>
                  <option value="newest">Newest</option>
                </select>
              </label>
            </div>
          )}
          <div className="candidate-tabs">
            {["all", "decision", "rule", "fact", "preference", "regression", "warning", "inference"].map((item) => (
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
            {visible.map((candidate) => (
              <div
                className={
                  candidate.id === selected?.id ? "candidate-row is-selected" : "candidate-row"
                }
                key={candidate.id}
              >
                <label className="candidate-row__check" title="Select candidate">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(candidate.id)}
                    onChange={() => toggleCandidate(candidate.id)}
                    aria-label={`Select ${candidate.title}`}
                  />
                </label>
                <button className="candidate-row__open" onClick={() => select(candidate)}>
                  <ReviewerAwareKindIcon item={candidate} reviewers={reviewers} />
                  <span>
                    <span className={`triage-pill triage-pill--${candidate.triage?.action ?? "untriaged"}`}>
                      {triageActionLabel(candidate)}
                    </span>
                    <strong>{candidate.title}</strong>
                    <small>
                      {candidate.kind} · <em>{Math.round(candidate.confidence * 100)}% confidence</em>{" "}
                      · {candidate.evidenceIds.length} sources
                    </small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              </div>
            ))}
            {!filtered.length && (
              <EmptyState
                title="Nothing matches"
                body="Try a different search or candidate class."
              />
            )}
          </div>
          <footer>
            <span>
              {filtered.length
                ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filtered.length)} of ${filtered.length}`
                : "0 candidates"}
            </span>
            <span className="candidate-pagination">
              <button aria-label="Previous candidate page" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
                <ChevronLeft size={14} />
              </button>
              {page}/{totalPages}
              <button aria-label="Next candidate page" disabled={page === totalPages} onClick={() => setPage((value) => value + 1)}>
                <ChevronRight size={14} />
              </button>
            </span>
          </footer>
        </aside>

        {selected ? (
          <main className="candidate-detail" ref={detailRef}>
            <div className="candidate-detail__scroll" ref={detailScrollRef}>
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
            {selected.triage ? (
              <section className={`candidate-triage-card candidate-triage-card--${selected.triage.action}`}>
                <div className="candidate-triage-card__heading">
                  <Sparkles size={17} />
                  <div>
                    <span>{selected.triage.method === "ai" ? "AI recommendation" : "Lore quality check"}</span>
                    <strong>{triageActionLabel(selected)}</strong>
                  </div>
                  <em>{Math.round(selected.triage.confidence * 100)}% triage confidence</em>
                </div>
                <p>{selected.triage.explanation}</p>
                <ul>
                  {selected.triage.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
                <div className="candidate-triage-card__meta">
                  <span>Durability: {selected.triage.durability.replaceAll("_", " ")}</span>
                  <span>
                    {selected.triage.policyFit === "possible_policy"
                      ? "Possible policy — individual review required"
                      : "Not an enforcement policy"}
                  </span>
                  {selected.triage.bulkEligibleAction && (
                    <span>Guarded for bulk {selected.triage.bulkEligibleAction}</span>
                  )}
                </div>
                {(selected.triage.recommendedKind || selected.triage.recommendedStatement) && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (selected.triage?.recommendedKind) setDraftKind(selected.triage.recommendedKind);
                      if (selected.triage?.recommendedStatement) setStatement(selected.triage.recommendedStatement);
                    }}
                  >
                    Apply suggestion to draft
                  </Button>
                )}
                <small>Recommendation only. No candidate changes until you confirm an action.</small>
              </section>
            ) : (
              <div className="candidate-triage-empty">
                <Sparkles size={17} />
                <span>
                  <strong>Not triaged yet</strong>
                  Ask Lore to separate durable knowledge from one-off commit activity.
                </span>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSelectedIds(new Set([selected.id]));
                    setForceTriage(false);
                    setTriageOpen(true);
                  }}
                >
                  Analyse candidate
                </Button>
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
                <div className="candidate-rationale">
                  <Sparkles size={16} />
                  <div>
                    <strong>Parsed rationale</strong>
                    <p>{selected.rationale}</p>
                  </div>
                </div>
                <h4>Supporting evidence</h4>
                {selected.evidence.map((item) => {
                  const preview = createEvidencePreview(
                    item.content,
                    `${selected.title} ${statement} ${selected.rationale}`,
                    undefined,
                    item.type
                  );
                  const evidenceReviewer = findReviewer(reviewers, item.author);
                  return (
                    <article key={item.id}>
                      <span className="timeline-check">
                        <Check size={13} />
                      </span>
                      <div>
                        <strong>{item.title ?? item.externalId}</strong>
                        <time>{formatDate(item.occurredAt)}</time>
                        {item.author ? (
                          <span className="evidence-author">
                            {evidenceReviewer ? (
                              <ReviewerAvatar reviewer={evidenceReviewer} size="small" />
                            ) : (
                              <UserRoundCheck size={16} aria-hidden="true" />
                            )}
                            <span>
                              {item.type === "review_comment" ? "Review by " : "Authored by "}
                              {evidenceReviewer?.name ?? `@${item.author}`}
                            </span>
                          </span>
                        ) : null}
                        <p className="evidence-preview">{preview.text}</p>
                        <div className="evidence-source-actions">
                          {item.url && (
                            <a href={item.url} target="_blank" rel="noreferrer">
                              Open evidence <ExternalLink size={13} />
                            </a>
                          )}
                          {preview.truncated && (
                            <details className="evidence-full-source">
                              <summary>View full retained source</summary>
                              <pre>{item.content}</pre>
                            </details>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
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
            </div>
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
                    selected.triage?.duplicateTargetId &&
                      mergeTargets.some((item) => item.id === selected.triage?.duplicateTargetId)
                      ? selected.triage.duplicateTargetId
                      : selected.comparison?.matchedKnowledgeIds.find((id) =>
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
            {triageOpen && (
              <Modal
                title="Triage candidate backlog"
                onClose={() => !working && setTriageOpen(false)}
                footer={
                  <>
                    <span className="modal-note">
                      <ShieldCheck size={14} /> Recommendations never change knowledge by themselves.
                    </span>
                    <Button
                      variant="secondary"
                      disabled={working}
                      onClick={() => setTriageOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      disabled={working || triageTargetIds.length === 0}
                      icon={working ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}
                      onClick={() => {
                        setWorking(true);
                        void onTriage(triageTargetIds, forceTriage)
                          .then(() => setTriageOpen(false))
                          .finally(() => setWorking(false));
                      }}
                    >
                      {working
                        ? "Starting triage…"
                        : `Analyse ${triageTargetIds.length} candidate${triageTargetIds.length === 1 ? "" : "s"}`}
                    </Button>
                  </>
                }
              >
                <div className="triage-dialog">
                  <div className="triage-dialog__summary">
                    <Sparkles size={22} />
                    <span>
                      <strong>
                        {selectedIds.size
                          ? `${selectedIds.size} selected candidate${selectedIds.size === 1 ? "" : "s"}`
                          : `${filtered.length} filtered candidate${filtered.length === 1 ? "" : "s"}`}
                      </strong>
                      {triageTargetIds.length
                        ? `${triageTargetIds.length} will be checked in ${Math.ceil(triageTargetIds.length / 10)} small AI batch${Math.ceil(triageTargetIds.length / 10) === 1 ? "" : "es"}.`
                        : "Every candidate in this group already has current triage."}
                    </span>
                  </div>
                  <ol className="triage-dialog__steps">
                    <li>
                      <strong>Quality checks run first</strong>
                      <span>Obvious one-off Git activity, duplicates, contradictions, and policy-like wording are separated without spending an AI request.</span>
                    </li>
                    <li>
                      <strong>OpenAI reviews only the ambiguous items</strong>
                      <span>Lore sends bounded candidate text and evidence excerpts—not an entire repository or pull request archive.</span>
                    </li>
                    <li>
                      <strong>You keep final authority</strong>
                      <span>AI may recommend add, edit, merge, ignore, or review. Possible policies always require individual human review.</span>
                    </li>
                  </ol>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={forceTriage}
                      onChange={(event) => setForceTriage(event.target.checked)}
                    />
                    <RefreshCw size={15} />
                    <span>
                      <strong>Re-analyse current recommendations</strong>
                      <small>Use this after the evidence or triage approach has materially changed.</small>
                    </span>
                  </label>
                </div>
              </Modal>
            )}
            {bulkAction && (
              <Modal
                title={bulkAction === "approve" ? "Add selected candidates" : "Ignore likely noise"}
                onClose={() => !working && setBulkAction(undefined)}
                footer={
                  <>
                    <Button
                      variant="secondary"
                      disabled={working}
                      onClick={() => setBulkAction(undefined)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant={bulkAction === "approve" ? "primary" : "danger"}
                      disabled={working || bulkActionIds.length === 0}
                      onClick={() => {
                        setWorking(true);
                        void onBulkReview(bulkAction, bulkActionIds)
                          .then((result) => {
                            const processed = new Set(result.processedIds);
                            setSelectedIds(
                              (current) => new Set([...current].filter((id) => !processed.has(id)))
                            );
                            setBulkAction(undefined);
                          })
                          .finally(() => setWorking(false));
                      }}
                    >
                      {working
                        ? "Applying…"
                        : bulkAction === "approve"
                          ? `Add ${bulkActionIds.length} to knowledge`
                          : `Ignore ${bulkActionIds.length} candidates`}
                    </Button>
                  </>
                }
              >
                <div className={`bulk-review-dialog bulk-review-dialog--${bulkAction}`}>
                  <div className="bulk-review-dialog__count">
                    <strong>{bulkActionIds.length}</strong>
                    <span>
                      {bulkAction === "approve"
                        ? `selected candidate${bulkActionIds.length === 1 ? "" : "s"} will be added`
                        : `candidate${bulkActionIds.length === 1 ? "" : "s"} pass the guarded bulk ignore checks`}
                    </span>
                  </div>
                  <p>
                    {bulkAction === "approve"
                      ? "Lore will create an active, audited knowledge revision for every candidate you explicitly selected. AI recommendations remain advisory; this confirmation is the human approval."
                      : "Lore will remove these high-confidence one-off or non-durable items from the queue. Their original evidence and the review action remain in the audit trail."}
                  </p>
                  {bulkAction === "ignore" && selectedIds.size > bulkActionIds.length && (
                    <div className="info-callout">
                      <ShieldCheck size={17} />
                      <span>
                        <strong>{selectedIds.size - bulkActionIds.length} selected candidate{selectedIds.size - bulkActionIds.length === 1 ? "" : "s"} will not be changed.</strong>{" "}
                        They did not pass the safeguards for this bulk action and remain available for individual review.
                      </span>
                    </div>
                  )}
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
  reviewers,
  onCreate,
  onStatusChange,
  onReviewCandidates
}: {
  items: KnowledgeItem[];
  repositories: RepositorySummary[];
  reviewers: ReviewerProfile[];
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
              <ReviewerAwareKindIcon item={item} reviewers={reviewers} />
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
  const [selectedSession, setSelectedSession] = useState<AgentSession>();
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string>();
  const [commandCopied, setCommandCopied] = useState(false);
  const reportsBySession = useMemo(
    () => new Map(data.reports.flatMap((report) => report.sessionId ? [[report.sessionId, report]] : [])),
    [data.reports]
  );

  useEffect(() => {
    if (!selectedSession) return;
    let active = true;
    setSessionLoading(true);
    setSessionError(undefined);
    void Promise.all([
      loreApi.agentSession(selectedSession.id),
      loreApi.agentSessionEvents(selectedSession.id)
    ]).then(([session, events]) => {
      if (!active) return;
      setSelectedSession(session);
      setSessionEvents(events.items);
    }).catch((cause: unknown) => {
      if (active) setSessionError(cause instanceof Error ? cause.message : "Session details could not be loaded");
    }).finally(() => {
      if (active) setSessionLoading(false);
    });
    return () => { active = false; };
  }, [selectedSession?.id]);

  const selectedReport = selectedSession ? reportsBySession.get(selectedSession.id) : undefined;
  const selectedRepository = selectedSession
    ? data.repositories.find((repository) => repository.id === selectedSession.repositoryId)
    : undefined;
  const selectedFiles = selectedReport?.changedFiles.map((file) => file.path) ?? selectedSession?.filesChanged ?? [];
  const selectedCountsAvailable = selectedSession?.status === "completed";

  return (
    <div className="page-pad">
      <PageHeader
        title="Agent sessions"
        description="See the context Lore prepared, files an agent touched, and verification state."
      />
      <div className="session-list">
        {!data.sessions.length && (
          <EmptyState title="No agent sessions yet" body="Run an agent through the Lore CLI to retain its context and verification lifecycle here." />
        )}
        {data.sessions.map((session) => {
          const report = reportsBySession.get(session.id);
          const countsAvailable = session.status === "completed";
          const changedFileCount = report?.changedFiles.length ?? session.filesChanged.length;
          const warningCount = report?.warnings.length ?? session.warningCount;
          return (
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
                <strong title={countsAvailable ? undefined : "Available after verification completes"}>
                  {countsAvailable ? changedFileCount : "—"}
                </strong>
              </div>
              <div>
                <span>Warnings</span>
                <strong title={countsAvailable ? undefined : "Available after verification completes"}>
                  {countsAvailable ? warningCount : "—"}
                </strong>
              </div>
              <Button variant="secondary" onClick={() => setSelectedSession(session)}>Open session</Button>
              <ChevronRight size={17} aria-hidden="true" />
            </article>
          );
        })}
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
        <Button
          variant="secondary"
          icon={commandCopied ? <Check size={15} /> : <Copy size={15} />}
          onClick={() => {
            void navigator.clipboard.writeText('lore agent codex "your task"').then(() => {
              setCommandCopied(true);
              window.setTimeout(() => setCommandCopied(false), 2_000);
            }).catch(() => setCommandCopied(false));
          }}
        >
          {commandCopied ? "Copied" : "Copy command"}
        </Button>
      </div>
      {selectedSession && (
        <Modal title="Agent session" wide onClose={() => setSelectedSession(undefined)}>
          <div className="session-detail">
            <header>
              <span className={`session-status session-status--${selectedSession.status}`}><Code2 size={18} /></span>
              <div>
                <h3>{selectedSession.task}</h3>
                <p>{selectedRepository ? `${selectedRepository.owner}/${selectedRepository.name}` : selectedSession.repositoryId}</p>
              </div>
              <span className={`job-state job-state--${selectedSession.status}`}>{selectedSession.status}</span>
            </header>
            {!selectedCountsAvailable && (
              <div className="info-callout">
                <CircleHelp size={17} />
                <span><strong>Verification has not completed.</strong> Changed-file and warning totals are not available yet, so Lore shows a dash instead of a misleading zero.</span>
              </div>
            )}
            {sessionError && <div className="form-error">{sessionError}</div>}
            <dl className="session-detail__stats">
              <div><dt>Agent</dt><dd>{selectedSession.agentType}</dd></div>
              <div><dt>Started</dt><dd>{relativeTime(selectedSession.startedAt)}</dd></div>
              <div><dt>Changed files</dt><dd>{selectedCountsAvailable ? selectedFiles.length : "Not verified"}</dd></div>
              <div><dt>Warnings</dt><dd>{selectedCountsAvailable ? selectedReport?.warnings.length ?? selectedSession.warningCount : "Not verified"}</dd></div>
            </dl>
            {(selectedSession.baseCommit || selectedSession.currentCommit) && (
              <div className="session-detail__commits">
                {selectedSession.baseCommit && <p><span>Base commit</span><code>{selectedSession.baseCommit}</code></p>}
                {selectedSession.currentCommit && <p><span>Current commit</span><code>{selectedSession.currentCommit}</code></p>}
              </div>
            )}
            <section>
              <h4>Changed files</h4>
              {selectedFiles.length ? (
                <ul className="session-file-list">{selectedFiles.map((path) => <li key={path}><FileCode2 size={14} /><code>{path}</code></li>)}</ul>
              ) : (
                <p className="detail-empty">{selectedCountsAvailable ? "No files changed in this verified session." : "No verified file list is available."}</p>
              )}
            </section>
            <section>
              <h4>Lifecycle</h4>
              {sessionLoading ? <p className="detail-empty">Loading lifecycle…</p> : sessionEvents.length ? (
                <ol className="session-event-list">
                  {sessionEvents.map((event) => (
                    <li key={event.id}>
                      <CheckCircle2 size={15} />
                      <span><strong>{event.type.replaceAll("_", " ")}</strong><small>{relativeTime(event.createdAt)}</small></span>
                    </li>
                  ))}
                </ol>
              ) : <p className="detail-empty">No lifecycle events were recorded.</p>}
            </section>
          </div>
        </Modal>
      )}
    </div>
  );
}

const jobName = (value: JobRunRecord["name"]): string => ({
  "repository.index": "Repository indexing",
  "github.import": "GitHub evidence import",
  "knowledge.extract": "AI candidate extraction",
  "candidate.triage": "AI candidate triage",
  "knowledge.health": "Knowledge health review"
})[value];

const jobProgressMessage = (job: JobRunRecord): string | undefined =>
  job.events?.toReversed().find((event) => event.message?.startsWith("GitHub "))?.message;

export function JobsPage() {
  const [jobs, setJobs] = useState<JobRunRecord[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [expandedJobId, setExpandedJobId] = useState<string>();

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
            <article key={job.id} className={expandedJobId === job.id ? "is-expanded" : undefined}>
              <button
                type="button"
                className="job-summary"
                aria-expanded={expandedJobId === job.id}
                onClick={() => setExpandedJobId((current) => current === job.id ? undefined : job.id)}
              >
                <span className={`session-status job-status--${job.state}`}>
                  {job.state === "running" || job.state === "retrying" ? <LoaderCircle size={18} /> : <History size={18} />}
                </span>
                <span className="job-summary__title">
                  <strong>{jobName(job.name)}</strong>
                  <small>{job.state.replace("_", " ")} · queued {relativeTime(job.queuedAt)}</small>
                  {job.errorMessage && <em>{job.errorMessage}</em>}
                  {!job.errorMessage && jobProgressMessage(job) && <em className="job-progress">{jobProgressMessage(job)}</em>}
                </span>
                <span className="job-summary__metric"><small>Attempt</small><strong>{job.attempt}/{job.maximumAttempts}</strong></span>
                <span className="job-summary__metric"><small>Events</small><strong>{job.events?.length ?? 0}</strong></span>
                <span className={`job-state job-state--${job.state}`}>{job.state.replace("_", " ")}</span>
                <ChevronRight className="job-summary__chevron" size={17} aria-hidden="true" />
              </button>
              {expandedJobId === job.id && (
                <div className="job-details">
                  <dl>
                    <div><dt>Job ID</dt><dd><code>{job.id}</code></dd></div>
                    {job.repositoryId && <div><dt>Repository ID</dt><dd><code>{job.repositoryId}</code></dd></div>}
                    <div><dt>Queued</dt><dd>{new Date(job.queuedAt).toLocaleString()}</dd></div>
                    {job.startedAt && <div><dt>Started</dt><dd>{new Date(job.startedAt).toLocaleString()}</dd></div>}
                    {job.finishedAt && <div><dt>Finished</dt><dd>{new Date(job.finishedAt).toLocaleString()}</dd></div>}
                    <div><dt>Idempotency key</dt><dd><code>{job.idempotencyKey}</code></dd></div>
                  </dl>
                  {job.resultSummary && (
                    <section><h3>Result</h3><pre>{JSON.stringify(job.resultSummary, null, 2)}</pre></section>
                  )}
                  <section>
                    <h3>Event timeline</h3>
                    {job.events?.length ? (
                      <ol className="job-event-list">
                        {job.events.map((event) => (
                          <li key={event.id}>
                            <span className={`job-state job-state--${event.state}`}>{event.state.replace("_", " ")}</span>
                            <div><strong>{event.message ?? "State updated"}</strong><small>{new Date(event.createdAt).toLocaleString()}</small></div>
                          </li>
                        ))}
                      </ol>
                    ) : <p className="detail-empty">No event details were recorded.</p>}
                  </section>
                </div>
              )}
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
        {!data.reviewers.length && (
          <EmptyState
            title="No reviewer signals yet"
            body="Import GitHub pull requests and review comments. Lore will derive reviewer profiles from the identities retained in that evidence."
          />
        )}
        {data.reviewers.map((reviewer) => {
          const reviewerIdentities = new Set(
            [reviewer.providerIdentity, reviewer.email]
              .filter((value): value is string => Boolean(value))
              .map((value) => value.replace(/^@/, "").toLowerCase())
          );
          const preferences = data.knowledge.filter(
            (item) =>
              item.kind === "preference" &&
              typeof item.scope.reviewer === "string" &&
              reviewerIdentities.has(item.scope.reviewer.replace(/^@/, "").toLowerCase())
          );
          return (
            <article key={reviewer.id}>
              <ReviewerAvatar reviewer={reviewer} className="reviewer-card-avatar" />
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
