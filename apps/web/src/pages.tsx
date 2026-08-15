import { useEffect, useRef, useState, type FormEvent } from "react";
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
  Link2,
  ListFilter,
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
  ContextPackage,
  DashboardSnapshot,
  KnowledgeItem,
  KnowledgeKind,
  KnowledgeScope,
  PolicyRecord,
  RepositoryRetentionConfig,
  RepositorySummary,
  SafetyReport
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

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(value)
  );

const relativeTime = (value: string): string => {
  const hours = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 3_600_000));
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

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
  onApprove,
  onReject,
  onMerge
}: {
  candidates: CandidateRecord[];
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
                disabled={working || candidates.length < 2}
                onClick={() => {
                  setMergeTargetId(candidates.find((item) => item.id !== selected.id)?.id ?? "");
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
                      {candidates
                        .filter((item) => item.id !== selected.id)
                        .map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.title}
                          </option>
                        ))}
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
  onStatusChange
}: {
  items: KnowledgeItem[];
  repositories: RepositorySummary[];
  onCreate: (input: Record<string, unknown>) => Promise<void>;
  onStatusChange: (
    item: KnowledgeItem,
    status: "challenged" | "archived",
    reason: string
  ) => Promise<void>;
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
  onConnect,
  onIndex,
  onImport,
  onDelete,
  onRetention
}: {
  repositories: RepositorySummary[];
  onConnect: (input: Record<string, unknown>) => Promise<void>;
  onIndex: (repository: RepositorySummary) => Promise<void>;
  onImport: (repository: RepositorySummary, limit: 50 | 100 | 250 | 500 | 1000) => Promise<void>;
  onDelete: (repository: RepositorySummary, confirmation: string) => Promise<void>;
  onRetention: (
    repository: RepositorySummary,
    retentionConfig: RepositoryRetentionConfig
  ) => Promise<void>;
}) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [importRepository, setImportRepository] = useState<RepositorySummary>();
  const [installationId, setInstallationId] = useState("");
  const [importLimit, setImportLimit] = useState<50 | 100 | 250 | 500 | 1000>(100);
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
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
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    try {
      await onConnect({
        provider: "github",
        owner,
        name,
        defaultBranch: "main",
        ...(installationId ? { providerInstallationId: installationId } : {})
      });
      setConnectOpen(false);
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
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setConnectOpen(true)}>
            Connect repository
          </Button>
        }
      />
      <div className="onboarding-strip">
        <div>
          <strong>Get a repository ready in three steps</strong>
          <p>Connect GitHub, import merged pull requests, then index the local checkout.</p>
        </div>
        {["Repository connected", "History imported", "Local graph indexed"].map((step, index) => (
          <span key={step} className={index === 0 ? "is-complete" : ""}>
            <i>{index === 0 ? <Check size={13} /> : index + 1}</i>
            {step}
          </span>
        ))}
      </div>
      <div className="repository-list">
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
            <ChevronRight size={18} />
          </article>
        ))}
      </div>
      {connectOpen && (
        <Modal
          title="Connect a GitHub repository"
          onClose={() => setConnectOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConnectOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                form="connect-repository"
                type="submit"
                disabled={saving || !installationId}
              >
                {saving ? "Connecting…" : "Connect repository"}
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
                <strong>Install the Lore GitHub App first</strong> The installation identity is
                stored with this repository and used to scope imports and webhooks.
              </span>
            </div>
            <div className="form-grid">
              <FormField label="Owner">
                <input
                  name="repositoryOwner"
                  required
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  placeholder="acme"
                />
              </FormField>
              <FormField label="Repository">
                <input
                  name="repositoryName"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="commerce"
                />
              </FormField>
            </div>
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
                <strong>Start bounded, then expand</strong> Lore uses the installation already
                registered to this repository and stores evidence, not a second source checkout.
              </span>
            </div>
            <FormField label="Merged pull requests">
              <select
                name="importLimit"
                value={importLimit}
                onChange={(event) =>
                  setImportLimit(Number(event.target.value) as 50 | 100 | 250 | 500 | 1000)
                }
              >
                {[50, 100, 250, 500, 1000].map((limit) => (
                  <option value={limit} key={limit}>
                    {limit}
                  </option>
                ))}
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

export function SettingsPage({ mode }: { mode: "demo" | "persistent" }) {
  const [copied, setCopied] = useState<string>();
  const copy = (id: string, value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(id);
    window.setTimeout(() => setCopied(undefined), 1500);
  };
  const snippets = [
    ["CLI", "npm install && npm run cli -- init"],
    ["Prepare a task", 'npm run cli -- prepare "SS-6160 Update Avalara mapping"'],
    ["MCP server", "npm run mcp"],
    ["Verify a change", "npm run cli -- verify"]
  ];
  return (
    <div className="page-pad settings-page">
      <PageHeader
        title="Settings & setup"
        description="Everything needed to run Lore locally and connect an agent."
      />
      <section>
        <h2>Quick start</h2>
        <p>
          Demo mode needs no credentials. Start the API and web app, explore seeded evidence, then
          point the CLI at a real checkout.
        </p>
        <ol>
          <li>
            <span>1</span>
            <div>
              <strong>Install and start</strong>
              <code>npm install &amp;&amp; npm run dev</code>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Open the control plane</strong>
              <code>http://localhost:5173</code>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Initialise a local checkout</strong>
              <code>lore init &amp;&amp; lore index</code>
            </div>
          </li>
          <li>
            <span>4</span>
            <div>
              <strong>Wrap Codex</strong>
              <code>lore agent codex "your task"</code>
            </div>
          </li>
        </ol>
      </section>
      <section>
        <h2>Agent integration</h2>
        <div className="snippet-list">
          {snippets.map(([name, command]) => (
            <div key={name}>
              <span>{name}</span>
              <code>{command}</code>
              <button onClick={() => copy(name!, command!)}>
                {copied === name ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2>Runtime mode</h2>
        <div className="settings-row">
          <div>
            <strong>{mode === "demo" ? "Demo" : "Persistent service"}</strong>
            <p>
              {mode === "demo"
                ? "Seeded organisation; no GitHub or AI credentials required."
                : "PostgreSQL and Redis are authoritative; fixture fallback is disabled."}
            </p>
          </div>
          <span className="status-label">Active</span>
        </div>
        <div className="settings-row">
          <div>
            <strong>Raw source retention</strong>
            <p>
              Source remains on the local node. Lore stores symbols, relationships, and evidence.
            </p>
          </div>
          <span>Per repository</span>
        </div>
        <div className="settings-row">
          <div>
            <strong>AI provider</strong>
            <p>
              Provider boundary uses validated schemas. Deterministic systems remain authoritative.
            </p>
          </div>
          <span>Mock (local)</span>
        </div>
      </section>
      <section>
        <h2>Documentation</h2>
        <p>These guides ship with this checkout and stay versioned with the implementation.</p>
        <div className="docs-links">
          <button onClick={() => copy("readme", "README.md")}>
            <BookOpen size={17} />
            <span>
              README &amp; quick start<small>README.md</small>
            </span>
            {copied === "readme" ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button onClick={() => copy("architecture", "docs/architecture.md")}>
            <Braces size={17} />
            <span>
              Architecture &amp; security<small>docs/architecture.md</small>
            </span>
            {copied === "architecture" ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </section>
    </div>
  );
}
