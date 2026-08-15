import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  ChevronDown,
  Command,
  Database,
  Home,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  UsersRound,
  X
} from "lucide-react";
import type {
  CandidateRecord,
  ContextPackage,
  DashboardSnapshot,
  KnowledgeItem,
  PolicyRecord,
  RepositoryRetentionConfig,
  RepositorySummary
} from "@lore/shared/types.js";
import { Brand, Toast } from "./components.js";
import { loreApi } from "./api.js";
import {
  CandidatesPage,
  DashboardPage,
  KnowledgePage,
  PoliciesPage,
  RepositoriesPage,
  ReportsPage,
  ReviewersPage,
  SessionsPage,
  SettingsPage
} from "./pages.js";

type PageId = "dashboard" | "repositories" | "knowledge" | "candidates" | "policies" | "sessions" | "reports" | "reviewers" | "settings";

const navItems: Array<{ id: PageId; label: string; icon: typeof Home }> = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "repositories", label: "Repositories", icon: Database },
  { id: "knowledge", label: "Knowledge", icon: BookOpen },
  { id: "candidates", label: "Candidates", icon: Sparkles },
  { id: "policies", label: "Policies", icon: ShieldCheck },
  { id: "sessions", label: "Sessions", icon: TerminalSquare },
  { id: "reports", label: "Safety reports", icon: AlertTriangle },
  { id: "reviewers", label: "Reviewers", icon: UsersRound }
];

const emptySnapshot: DashboardSnapshot = {
  organisation: { id: "", name: "Lore", slug: "" },
  repositories: [],
  knowledge: [],
  candidates: [],
  policies: [],
  reports: [],
  reviewers: [],
  sessions: []
};

const pageFromHash = (): PageId => {
  const page = window.location.hash.slice(1) as PageId;
  return [...navItems.map((item) => item.id), "settings"].includes(page) ? page : "dashboard";
};

export function App() {
  const [data, setData] = useState<DashboardSnapshot>(emptySnapshot);
  const [page, setPage] = useState<PageId>(() => pageFromHash());
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [mobileNav, setMobileNav] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: "success" | "error" }>();

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([loreApi.bootstrap(), loreApi.session()])
      .then(([snapshot, session]) => {
        if (active) {
          setData(snapshot);
          setApiConnected(true);
          setDemoMode(session.demoMode);
          setLoadError(undefined);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setApiConnected(false);
          setLoadError(error instanceof Error ? error.message : "Lore API is unavailable");
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  const navigate = (next: string): void => {
    const safePage = [...navItems.map((item) => item.id), "settings"].includes(next as PageId) ? (next as PageId) : "dashboard";
    window.location.hash = safePage;
    setPage(safePage);
    setMobileNav(false);
    setPaletteOpen(false);
  };

  const notify = (message: string, tone: "success" | "error" = "success"): void => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(undefined), 3200);
  };

  const prepare = async (task: string, repositoryId: string): Promise<ContextPackage> => {
    if (!apiConnected) throw new Error("Start `npm run dev` to prepare deterministic context. The current screen is read-only demo data.");
    return loreApi.prepareTask(repositoryId, task);
  };

  const approveCandidate = async (
    candidate: CandidateRecord,
    draft: Pick<CandidateRecord, "statement" | "kind" | "scope">
  ): Promise<void> => {
    try {
      if (!apiConnected) throw new Error("Lore is disconnected; no changes were saved.");
      await loreApi.approveCandidate(candidate.id, { ...draft, reason: "Approved in candidate review" });
      const approved = {
        ...candidate,
        ...draft,
        status: "active" as const,
        confidence: Math.max(candidate.confidence, 0.86),
        health: "healthy" as const,
        lastConfirmedAt: new Date().toISOString()
      };
      setData((snapshot) => ({
        ...snapshot,
        candidates: snapshot.candidates.filter((item) => item.id !== candidate.id),
        knowledge: [approved, ...snapshot.knowledge]
      }));
      notify("Candidate approved and revision audited");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Approval failed", "error");
      throw error;
    }
  };

  const createKnowledge = async (input: Record<string, unknown>): Promise<void> => {
    try {
      if (!apiConnected) throw new Error("Lore is disconnected; no changes were saved.");
      const created = await loreApi.createKnowledge(input);
      setData((snapshot) => ({ ...snapshot, knowledge: [created, ...snapshot.knowledge] }));
      notify("Knowledge confirmed with manual evidence");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Knowledge creation failed", "error");
      throw error;
    }
  };

  const changeKnowledgeStatus = async (item: KnowledgeItem, status: "challenged" | "archived", reason: string): Promise<void> => {
    try {
      if (!apiConnected) throw new Error("Lore is disconnected; no changes were saved.");
      const updated = status === "challenged"
        ? await loreApi.challengeKnowledge(item.id, reason)
        : await loreApi.archiveKnowledge(item.id, reason);
      setData((snapshot) => ({
        ...snapshot,
        knowledge: status === "archived"
          ? snapshot.knowledge.filter((knowledge) => knowledge.id !== item.id)
          : snapshot.knowledge.map((knowledge) => knowledge.id === item.id ? updated : knowledge)
      }));
      notify(status === "challenged" ? "Knowledge challenged for review" : "Knowledge archived");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Knowledge update failed", "error");
      throw error;
    }
  };

  const rejectCandidate = async (candidate: CandidateRecord): Promise<void> => {
    try {
      if (!apiConnected) throw new Error("Lore is disconnected; no changes were saved.");
      await loreApi.rejectCandidate(candidate.id, "Rejected during candidate review");
      setData((snapshot) => ({ ...snapshot, candidates: snapshot.candidates.filter((item) => item.id !== candidate.id) }));
      notify("Candidate rejected; evidence retained");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Rejection failed", "error");
      throw error;
    }
  };

  const mergeCandidate = async (candidate: CandidateRecord, targetId: string): Promise<void> => {
    try {
      const target = data.candidates.find((item) => item.id === targetId) ?? data.knowledge.find((item) => item.id === targetId);
      if (!target) throw new Error("Choose an available knowledge target");
      if (!apiConnected) throw new Error("Lore is disconnected; no changes were saved.");
      const merged = await loreApi.mergeCandidate(candidate.id, targetId, "Merged as duplicate during candidate review");
      setData((snapshot) => ({
        ...snapshot,
        candidates: snapshot.candidates
          .filter((item) => item.id !== candidate.id)
          .map((item) => item.id === targetId && merged.status === "candidate" ? merged as CandidateRecord : item),
        knowledge: snapshot.knowledge.map((item) => item.id === targetId && merged.status !== "candidate" ? merged : item)
      }));
      notify("Candidate merged; evidence and provenance preserved");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Candidate merge failed", "error");
      throw error;
    }
  };

  const connectRepository = async (input: Record<string, unknown>): Promise<void> => {
    try {
      if (!apiConnected) throw new Error("Lore is disconnected; no changes were saved.");
      const repository = (await loreApi.connectRepository(input)) as RepositorySummary;
      setData((snapshot) => ({ ...snapshot, repositories: [...snapshot.repositories, repository] }));
      notify("Repository connected. Import history next.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Repository connection failed", "error");
      throw error;
    }
  };

  const indexRepository = async (repository: RepositorySummary): Promise<void> => {
    try {
      if (!apiConnected) throw new Error("Lore is disconnected; no job was queued.");
      await loreApi.indexRepository(repository.id);
      notify("Repository indexing queued");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Indexing could not start", "error");
    }
  };

  const importHistory = async (
    repository: RepositorySummary,
    installationId: number,
    limit: 50 | 100 | 250 | 500 | 1000
  ): Promise<void> => {
    try {
      if (!apiConnected) throw new Error("Start the Lore API and worker before importing GitHub history.");
      await loreApi.importHistory(repository.id, installationId, limit);
      notify(`Import of ${limit} merged pull requests queued`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Historical import could not start", "error");
      throw error;
    }
  };

  const deleteRepository = async (repository: RepositorySummary, confirmation: string): Promise<void> => {
    try {
      if (!apiConnected) throw new Error("Lore is disconnected; no changes were saved.");
      const result = await loreApi.deleteRepository(repository.id, confirmation);
      setData((snapshot) => ({
        ...snapshot,
        repositories: snapshot.repositories.filter((item) => item.id !== result.deletedId),
        knowledge: snapshot.knowledge
          .filter((item) => item.repositoryId !== result.deletedId)
          .map((item) => result.challengedKnowledgeIds.includes(item.id) ? { ...item, status: "challenged" as const, health: "conflicted" as const } : item),
        candidates: snapshot.candidates.filter((item) => item.repositoryId !== result.deletedId),
        policies: snapshot.policies.filter((item) => item.repositoryId !== result.deletedId),
        sessions: snapshot.sessions.filter((item) => item.repositoryId !== result.deletedId),
        reports: snapshot.reports.filter((item) => item.repositoryId !== result.deletedId)
      }));
      notify(result.challengedKnowledgeIds.length > 0
        ? `Repository deleted; ${result.challengedKnowledgeIds.length} organisation knowledge item(s) need reconfirmation`
        : "Repository and repository-scoped data deleted");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Repository deletion failed", "error");
      throw error;
    }
  };

  const updateRepositoryRetention = async (
    repository: RepositorySummary,
    retentionConfig: RepositoryRetentionConfig
  ): Promise<void> => {
    try {
      if (!apiConnected) throw new Error("Lore is disconnected; no changes were saved.");
      const updated = await loreApi.updateRepositoryRetention(repository.id, retentionConfig);
      setData((snapshot) => ({
        ...snapshot,
        repositories: snapshot.repositories.map((item) => item.id === repository.id ? updated : item)
      }));
      notify("Repository retention policy updated and audited");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Retention policy update failed", "error");
      throw error;
    }
  };

  const createPolicy = async (
    policy: Omit<PolicyRecord, "id" | "organisationId" | "createdAt" | "updatedAt">
  ): Promise<void> => {
    try {
      if (!apiConnected) throw new Error("Lore is disconnected; no changes were saved.");
      const created = (await loreApi.createPolicy(policy)) as PolicyRecord;
      setData((snapshot) => ({ ...snapshot, policies: [created, ...snapshot.policies] }));
      notify("Policy created with an audit event");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Policy creation failed", "error");
      throw error;
    }
  };

  const pageContent = (() => {
    switch (page) {
      case "dashboard":
        return <DashboardPage data={data} onPrepare={prepare} onNavigate={navigate} />;
      case "repositories":
        return <RepositoriesPage repositories={data.repositories} onConnect={connectRepository} onIndex={indexRepository} onImport={importHistory} onDelete={deleteRepository} onRetention={updateRepositoryRetention} />;
      case "knowledge":
        return <KnowledgePage items={data.knowledge} repositories={data.repositories} onCreate={createKnowledge} onStatusChange={changeKnowledgeStatus} />;
      case "candidates":
        return <CandidatesPage candidates={data.candidates} onApprove={approveCandidate} onReject={rejectCandidate} onMerge={mergeCandidate} />;
      case "policies":
        return <PoliciesPage policies={data.policies} onCreate={createPolicy} />;
      case "sessions":
        return <SessionsPage data={data} />;
      case "reports":
        return <ReportsPage reports={data.reports} />;
      case "reviewers":
        return <ReviewersPage data={data} />;
      case "settings":
        return <SettingsPage />;
    }
  })();

  if (loading) {
    return <main className="connection-state"><Brand /><div className="loading-line" /><p>Loading evidence-backed engineering context…</p></main>;
  }

  if (loadError || !apiConnected) {
    return (
      <main className="connection-state connection-state--error">
        <Brand />
        <AlertTriangle size={28} />
        <h1>Lore is disconnected</h1>
        <p>{loadError ?? "The Lore API is unavailable."}</p>
        <p>No demo records have been substituted and all write actions remain disabled.</p>
        <button className="button button--primary" onClick={() => window.location.reload()}>Retry connection</button>
        <code>npm run dev</code>
      </main>
    );
  }

  return (
    <div className={mobileNav ? "app app--nav-open" : "app"}>
      <aside className="sidebar">
        <div className="sidebar__brand"><Brand /><button aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={20} /></button></div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button className={page === item.id ? "is-active" : ""} key={item.id} onClick={() => navigate(item.id)}>
                <Icon size={20} />
                <span>{item.label}</span>
                {item.id === "candidates" && data.candidates.length > 0 && <em>{data.candidates.length}</em>}
              </button>
            );
          })}
        </nav>
        <button className={page === "settings" ? "sidebar__settings is-active" : "sidebar__settings"} onClick={() => navigate("settings")}><Settings size={20} /><span>Settings</span></button>
      </aside>
      <div className="sidebar-scrim" onClick={() => setMobileNav(false)} />
      <section className="app-frame">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <button className="organisation-switcher"><span>{data.organisation.name}</span><i>/</i><strong>{data.repositories[0] ? `${data.repositories[0].owner}-${data.repositories[0].name}` : "No repository"}</strong><ChevronDown size={15} /></button>
          <button className="command-search" onClick={() => setPaletteOpen(true)}><Search size={17} /><span>Search or run a command…</span><kbd>⌘ K</kbd></button>
          <button className="notification" aria-label="Notifications"><Bell size={19} /><i /></button>
          <button className="avatar" aria-label="User menu">CH</button>
        </header>
        <main className="app-content">{pageContent}</main>
        <footer className="statusbar">
          <span><i className="is-online" />{demoMode ? "Demo mode · API online" : "Persistent mode · API online"}</span>
          <span><ClockIcon /> Last indexed {data.repositories[0]?.indexedAt ? relativeTime(data.repositories[0].indexedAt) : "never"}</span>
          <span>v0.1.0</span>
        </footer>
      </section>
      {paletteOpen && <CommandPalette data={data} onClose={() => setPaletteOpen(false)} onNavigate={navigate} />}
      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}

function ClockIcon() {
  return <span className="clock-icon" aria-hidden="true" />;
}

function CommandPalette({ data, onClose, onNavigate }: { data: DashboardSnapshot; onClose: () => void; onNavigate: (page: string) => void }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const needle = query.toLowerCase();
    return [
      ...navItems.map((item) => ({ id: item.id, label: `Open ${item.label}`, type: "Navigation", icon: item.icon })),
      ...data.knowledge.map((item) => ({ id: "knowledge" as const, label: item.title, type: item.kind, icon: BookOpen })),
      ...data.candidates.map((item) => ({ id: "candidates" as const, label: item.title, type: "Candidate", icon: Sparkles }))
    ].filter((item) => !needle || `${item.label} ${item.type}`.toLowerCase().includes(needle)).slice(0, 10);
  }, [data, query]);
  return (
    <div className="palette-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="palette" role="dialog" aria-label="Command search">
        <header><Search size={19} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search knowledge, candidates, or pages…" /><kbd>esc</kbd></header>
        <div>{results.map((item, index) => { const Icon = item.icon; return <button key={`${item.type}-${item.label}-${index}`} onClick={() => onNavigate(item.id)}><Icon size={17} /><span><strong>{item.label}</strong><small>{item.type}</small></span><Command size={14} /></button>; })}</div>
        <footer><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span><strong>Evidence first</strong></footer>
      </section>
    </div>
  );
}

function relativeTime(value: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
