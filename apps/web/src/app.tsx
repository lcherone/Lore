import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Building2,
  ChevronDown,
  Command,
  Database,
  Home,
  Menu,
  MessageSquareText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  UsersRound,
  UserRound,
  X
} from "lucide-react";
import type {
  AccountSession,
  CandidateRecord,
  CommunicationEvidenceAnalysis,
  CommunicationEvidenceInput,
  ContextPackage,
  DashboardSnapshot,
  KnowledgeItem,
  PolicyRecord,
  PullRequestImportLimit,
  RepositoryRetentionConfig,
  RepositorySummary,
  UserSettings
} from "@lore/shared/types.js";
import { Brand, Toast } from "./components.js";
import { loreApi, type GitHubIntegrationStatus } from "./api.js";
import {
  CandidatesPage,
  DashboardPage,
  EvidencePage,
  KnowledgePage,
  PoliciesPage,
  RepositoriesPage,
  ReportsPage,
  ReviewersPage,
  SessionsPage,
  SettingsPage
} from "./pages.js";
import { LoginPage, OrganisationOnboardingPage, OrganisationsPage, ProfilePage } from "./account-pages.js";

type PageId =
  | "dashboard"
  | "repositories"
  | "knowledge"
  | "evidence"
  | "candidates"
  | "policies"
  | "sessions"
  | "reports"
  | "reviewers"
  | "organisations"
  | "profile"
  | "settings";

const navItems: Array<{ id: PageId; label: string; icon: typeof Home }> = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "repositories", label: "Repositories", icon: Database },
  { id: "knowledge", label: "Knowledge", icon: BookOpen },
  { id: "evidence", label: "Add evidence", icon: MessageSquareText },
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
  return [...navItems.map((item) => item.id), "organisations", "profile", "settings"].includes(page) ? page : "dashboard";
};

const listCommunicationEvidence = async () => (await loreApi.listCommunicationEvidence()).items;

export function App() {
  const [data, setData] = useState<DashboardSnapshot>(emptySnapshot);
  const [page, setPage] = useState<PageId>(() => pageFromHash());
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [account, setAccount] = useState<AccountSession>();
  const [githubStatus, setGitHubStatus] = useState<GitHubIntegrationStatus>({
    mode: "disabled",
    historicalImportReady: false,
    installFlowReady: false,
    webhooksReady: false
  });
  const [userSettings, setUserSettings] = useState<UserSettings>();
  const [loadError, setLoadError] = useState<string>();
  const [mobileNav, setMobileNav] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [organisationMenuOpen, setOrganisationMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: "success" | "error" }>();
  const [githubInstallationId] = useState(
    () => new URLSearchParams(window.location.search).get("githubInstallationId") ?? undefined
  );

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!githubInstallationId) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("githubInstallationId");
    url.searchParams.delete("githubSetupAction");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [githubInstallationId]);

  const loadApplication = useCallback(async (): Promise<void> => {
    try {
      const session = await loreApi.session();
      setAccount(session);
      setDemoMode(session.demoMode);
      setApiConnected(true);
      setLoadError(undefined);
      if (session.authenticated && session.activeOrganisation) {
        const [snapshot, integration, configuredSettings] = await Promise.all([
          loreApi.bootstrap(),
          loreApi.githubStatus(),
          loreApi.settings()
        ]);
        setData(snapshot);
        setGitHubStatus(integration);
        setUserSettings(configuredSettings.user);
        if (!window.location.hash && !new URLSearchParams(window.location.search).has("invite")) {
          window.location.hash = configuredSettings.user.startPage;
          setPage(configuredSettings.user.startPage);
        }
      } else {
        setData(emptySnapshot);
        setUserSettings(undefined);
      }
      if (session.authenticated && new URLSearchParams(window.location.search).has("invite")) {
        window.location.hash = "organisations";
      }
    } catch (error) {
      setApiConnected(false);
      setLoadError(error instanceof Error ? error.message : "Lore API is unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadApplication(); }, [loadApplication]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const selected = userSettings?.theme ?? "system";
      document.documentElement.dataset.theme = selected === "system" ? (query.matches ? "dark" : "light") : selected;
    };
    applyTheme();
    query.addEventListener("change", applyTheme);
    return () => query.removeEventListener("change", applyTheme);
  }, [userSettings?.theme]);

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
    const safePage = [...navItems.map((item) => item.id), "organisations", "profile", "settings"].includes(next as PageId)
      ? (next as PageId)
      : "dashboard";
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
    if (!apiConnected)
      throw new Error(
        "Start `npm run dev` to prepare deterministic context. The current screen is read-only demo data."
      );
    return loreApi.prepareTask(repositoryId, task);
  };

  const approveCandidate = async (
    candidate: CandidateRecord,
    draft: Pick<CandidateRecord, "statement" | "kind" | "scope">
  ): Promise<void> => {
    try {
      if (!apiConnected) throw new Error("Lore is disconnected; no changes were saved.");
      await loreApi.approveCandidate(candidate.id, {
        ...draft,
        reason: "Approved in candidate review"
      });
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

  const analyseCommunication = async (
    input: CommunicationEvidenceInput
  ): Promise<CommunicationEvidenceAnalysis> => {
    if (!apiConnected) throw new Error("Lore is disconnected; no evidence was saved.");
    const analysis = await loreApi.analyseCommunication(input);
    setData((snapshot) => {
      const incoming = analysis.candidates.map((item) => item.candidate);
      const incomingIds = new Set(incoming.map((item) => item.id));
      return {
        ...snapshot,
        candidates: [...incoming, ...snapshot.candidates.filter((item) => !incomingIds.has(item.id))]
      };
    });
    notify(
      analysis.candidates.length
        ? `${analysis.candidates.length} suggestion${analysis.candidates.length === 1 ? "" : "s"} ready for review`
        : "Evidence saved; no decision or rule signals were found"
    );
    return analysis;
  };

  const changeKnowledgeStatus = async (
    item: KnowledgeItem,
    status: "challenged" | "archived",
    reason: string
  ): Promise<void> => {
    try {
      if (!apiConnected) throw new Error("Lore is disconnected; no changes were saved.");
      const updated =
        status === "challenged"
          ? await loreApi.challengeKnowledge(item.id, reason)
          : await loreApi.archiveKnowledge(item.id, reason);
      setData((snapshot) => ({
        ...snapshot,
        knowledge:
          status === "archived"
            ? snapshot.knowledge.filter((knowledge) => knowledge.id !== item.id)
            : snapshot.knowledge.map((knowledge) =>
                knowledge.id === item.id ? updated : knowledge
              )
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
      setData((snapshot) => ({
        ...snapshot,
        candidates: snapshot.candidates.filter((item) => item.id !== candidate.id)
      }));
      notify("Candidate rejected; evidence retained");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Rejection failed", "error");
      throw error;
    }
  };

  const mergeCandidate = async (candidate: CandidateRecord, targetId: string): Promise<void> => {
    try {
      const target =
        data.candidates.find((item) => item.id === targetId) ??
        data.knowledge.find((item) => item.id === targetId);
      if (!target) throw new Error("Choose an available knowledge target");
      if (!apiConnected) throw new Error("Lore is disconnected; no changes were saved.");
      const merged = await loreApi.mergeCandidate(
        candidate.id,
        targetId,
        "Merged as duplicate during candidate review"
      );
      setData((snapshot) => ({
        ...snapshot,
        candidates: snapshot.candidates
          .filter((item) => item.id !== candidate.id)
          .map((item) =>
            item.id === targetId && merged.status === "candidate"
              ? (merged as CandidateRecord)
              : item
          ),
        knowledge: snapshot.knowledge.map((item) =>
          item.id === targetId && merged.status !== "candidate" ? merged : item
        )
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
      setData((snapshot) => ({
        ...snapshot,
        repositories: [...snapshot.repositories, repository]
      }));
      notify("Repository connected. Import history next.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Repository connection failed", "error");
      throw error;
    }
  };

  const installGitHubApp = async (): Promise<void> => {
    try {
      if (!apiConnected) throw new Error("Lore is disconnected; GitHub setup cannot start.");
      const { url } = await loreApi.githubInstall();
      window.location.assign(url);
    } catch (error) {
      notify(error instanceof Error ? error.message : "GitHub App installation could not start", "error");
    }
  };

  const indexRepository = async (repository: RepositorySummary): Promise<void> => {
    try {
      if (!apiConnected) throw new Error("Lore is disconnected; no job was queued.");
      const result = await loreApi.indexRepository(repository.id);
      notify(
        result.simulated
          ? "Demo indexing simulated; no worker job was started"
          : "Repository indexing queued"
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Indexing could not start", "error");
    }
  };

  const importHistory = async (
    repository: RepositorySummary,
    limit: PullRequestImportLimit
  ): Promise<void> => {
    try {
      if (!apiConnected)
        throw new Error("Start the Lore API and worker before importing GitHub history.");
      const result = await loreApi.importHistory(repository.id, limit);
      notify(
        result.simulated
          ? `Demo import of ${limit} pull requests recorded without a worker`
          : `Import of ${limit} merged pull requests queued`
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Historical import could not start", "error");
      throw error;
    }
  };

  const deleteRepository = async (
    repository: RepositorySummary,
    confirmation: string
  ): Promise<void> => {
    try {
      if (!apiConnected) throw new Error("Lore is disconnected; no changes were saved.");
      const result = await loreApi.deleteRepository(repository.id, confirmation);
      setData((snapshot) => ({
        ...snapshot,
        repositories: snapshot.repositories.filter((item) => item.id !== result.deletedId),
        knowledge: snapshot.knowledge
          .filter((item) => item.repositoryId !== result.deletedId)
          .map((item) =>
            result.challengedKnowledgeIds.includes(item.id)
              ? { ...item, status: "challenged" as const, health: "conflicted" as const }
              : item
          ),
        candidates: snapshot.candidates.filter((item) => item.repositoryId !== result.deletedId),
        policies: snapshot.policies.filter((item) => item.repositoryId !== result.deletedId),
        sessions: snapshot.sessions.filter((item) => item.repositoryId !== result.deletedId),
        reports: snapshot.reports.filter((item) => item.repositoryId !== result.deletedId)
      }));
      notify(
        result.challengedKnowledgeIds.length > 0
          ? `Repository deleted; ${result.challengedKnowledgeIds.length} organisation knowledge item(s) need reconfirmation`
          : "Repository and repository-scoped data deleted"
      );
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
        repositories: snapshot.repositories.map((item) =>
          item.id === repository.id ? updated : item
        )
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

  const demoLogin = async (): Promise<void> => {
    await loreApi.demoLogin();
    await loadApplication();
  };

  const logout = async (): Promise<void> => {
    await loreApi.logout();
    setAccount(undefined);
    setData(emptySnapshot);
    await loadApplication();
  };

  const switchOrganisation = async (organisationId: string): Promise<void> => {
    if (organisationId === account?.activeOrganisation?.id) return;
    await loreApi.switchOrganisation(organisationId);
    setOrganisationMenuOpen(false);
    setLoading(true);
    await loadApplication();
  };

  const pageContent = (() => {
    switch (page) {
      case "dashboard":
        return <DashboardPage data={data} onPrepare={prepare} onNavigate={navigate} />;
      case "repositories":
        return (
          <RepositoriesPage
            repositories={data.repositories}
            githubStatus={githubStatus}
            installationId={githubInstallationId}
            onInstallGitHub={installGitHubApp}
            onConnect={connectRepository}
            onIndex={indexRepository}
            onImport={importHistory}
            onDelete={deleteRepository}
            onRetention={updateRepositoryRetention}
            defaultImportLimit={userSettings?.defaultImportLimit ?? 100}
            showGettingStarted={userSettings?.showGettingStarted ?? true}
          />
        );
      case "knowledge":
        return (
          <KnowledgePage
            items={data.knowledge}
            repositories={data.repositories}
            onCreate={createKnowledge}
            onStatusChange={changeKnowledgeStatus}
          />
        );
      case "evidence":
        return (
          <EvidencePage
            repositories={data.repositories}
            onAnalyse={analyseCommunication}
            onList={listCommunicationEvidence}
            onReview={() => navigate("candidates")}
          />
        );
      case "candidates":
        return (
          <CandidatesPage
            candidates={data.candidates}
            knowledge={data.knowledge}
            onApprove={approveCandidate}
            onReject={rejectCandidate}
            onMerge={mergeCandidate}
          />
        );
      case "policies":
        return <PoliciesPage policies={data.policies} onCreate={createPolicy} />;
      case "sessions":
        return <SessionsPage data={data} />;
      case "reports":
        return <ReportsPage reports={data.reports} />;
      case "reviewers":
        return <ReviewersPage data={data} />;
      case "organisations":
        return account ? <OrganisationsPage session={account} onRefresh={loadApplication} /> : null;
      case "profile":
        return account?.user ? (
          <ProfilePage
            profile={account.user}
            onUpdated={(user) => setAccount((current) => current ? { ...current, user } : current)}
            onLogout={logout}
          />
        ) : null;
      case "settings":
        return (
          <SettingsPage
            canManageOrganisation={["owner", "admin"].includes(account?.activeOrganisation?.role ?? "member")}
            onUserSettingsChanged={setUserSettings}
          />
        );
    }
  })();

  if (loading) {
    return (
      <main className="connection-state">
        <Brand />
        <div className="loading-line" />
        <p>Loading evidence-backed engineering context…</p>
      </main>
    );
  }

  if (loadError || !apiConnected) {
    return (
      <main className="connection-state connection-state--error">
        <Brand />
        <AlertTriangle size={28} />
        <h1>Lore is disconnected</h1>
        <p>{loadError ?? "The Lore API is unavailable."}</p>
        <p>No demo records have been substituted and all write actions remain disabled.</p>
        <button className="button button--primary" onClick={() => window.location.reload()}>
          Retry connection
        </button>
        <code>npm run dev</code>
      </main>
    );
  }

  if (!account?.authenticated) {
    return (
      <LoginPage
        demoMode={account?.demoMode ?? demoMode}
        githubLoginEnabled={account?.githubLoginEnabled ?? false}
        onDemoLogin={demoLogin}
      />
    );
  }

  if (!account.activeOrganisation) {
    return <OrganisationOnboardingPage session={account} onRefresh={loadApplication} />;
  }

  return (
    <div className={mobileNav ? "app app--nav-open" : "app"}>
      <aside className="sidebar">
        <div className="sidebar__brand">
          <Brand />
          <button aria-label="Close navigation" onClick={() => setMobileNav(false)}>
            <X size={20} />
          </button>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={page === item.id ? "is-active" : ""}
                key={item.id}
                onClick={() => navigate(item.id)}
              >
                <Icon size={20} />
                <span>{item.label}</span>
                {item.id === "candidates" && data.candidates.length > 0 && (
                  <em>{data.candidates.length}</em>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar__account">
          <button className={page === "organisations" ? "is-active" : ""} onClick={() => navigate("organisations")}>
            <Building2 size={20} /><span>Organisation</span>
          </button>
          <button className={page === "profile" ? "is-active" : ""} onClick={() => navigate("profile")}>
            <UserRound size={20} /><span>Your profile</span>
          </button>
          <button className={page === "settings" ? "is-active" : ""} onClick={() => navigate("settings")}>
            <Settings size={20} /><span>Settings</span>
          </button>
        </div>
      </aside>
      <div className="sidebar-scrim" onClick={() => setMobileNav(false)} />
      <section className="app-frame">
        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={() => setMobileNav(true)}
            aria-label="Open navigation"
          >
            <Menu size={21} />
          </button>
          <div className="organisation-switcher-wrap">
            <button className="organisation-switcher" aria-expanded={organisationMenuOpen} onClick={() => setOrganisationMenuOpen((value) => !value)}>
              <span>{account.activeOrganisation.name}</span>
              <i>/</i>
              <strong>{account.activeOrganisation.role}</strong>
              <ChevronDown size={15} />
            </button>
            {organisationMenuOpen && (
              <div className="organisation-menu">
                <small>Switch organisation</small>
                {account.organisations.map((organisation) => (
                  <button className={organisation.id === account.activeOrganisation?.id ? "is-active" : ""} key={organisation.id} onClick={() => void switchOrganisation(organisation.id)}>
                    <span>{organisation.name.slice(0, 1).toUpperCase()}</span>
                    <div><strong>{organisation.name}</strong><small>{organisation.role} · {organisation.memberCount} members</small></div>
                  </button>
                ))}
                <button className="organisation-menu__manage" onClick={() => { setOrganisationMenuOpen(false); navigate("organisations"); }}>Manage organisations</button>
              </div>
            )}
          </div>
          <button className="command-search" onClick={() => setPaletteOpen(true)}>
            <Search size={17} />
            <span>Search or run a command…</span>
            <kbd>⌘ K</kbd>
          </button>
          <button className="notification" aria-label="Notifications">
            <Bell size={19} />
            <i />
          </button>
          <button className="avatar" aria-label="Open your profile" onClick={() => navigate("profile")}>
            {account.user?.avatarUrl ? <img src={account.user.avatarUrl} alt="" /> : account.user?.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
          </button>
        </header>
        <main className="app-content">{pageContent}</main>
        <footer className="statusbar">
          <span>
            <i className="is-online" />
            {demoMode ? "Demo mode · API online" : "Persistent mode · API online"}
          </span>
          <span>
            <ClockIcon /> Last indexed{" "}
            {data.repositories[0]?.indexedAt
              ? relativeTime(data.repositories[0].indexedAt)
              : "never"}
          </span>
          <span>v0.1.0</span>
        </footer>
      </section>
      {paletteOpen && (
        <CommandPalette data={data} onClose={() => setPaletteOpen(false)} onNavigate={navigate} />
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}

function ClockIcon() {
  return <span className="clock-icon" aria-hidden="true" />;
}

function CommandPalette({
  data,
  onClose,
  onNavigate
}: {
  data: DashboardSnapshot;
  onClose: () => void;
  onNavigate: (page: string) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const needle = query.toLowerCase();
    return [
      ...navItems.map((item) => ({
        id: item.id,
        label: `Open ${item.label}`,
        type: "Navigation",
        icon: item.icon
      })),
      ...data.knowledge.map((item) => ({
        id: "knowledge" as const,
        label: item.title,
        type: item.kind,
        icon: BookOpen
      })),
      ...data.candidates.map((item) => ({
        id: "candidates" as const,
        label: item.title,
        type: "Candidate",
        icon: Sparkles
      }))
    ]
      .filter((item) => !needle || `${item.label} ${item.type}`.toLowerCase().includes(needle))
      .slice(0, 10);
  }, [data, query]);
  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="palette" role="dialog" aria-label="Command search">
        <header>
          <Search size={19} />
          <input
            name="commandSearch"
            aria-label="Search commands"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search knowledge, candidates, or pages…"
          />
          <kbd>esc</kbd>
        </header>
        <div>
          {results.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={`${item.type}-${item.label}-${index}`}
                onClick={() => onNavigate(item.id)}
              >
                <Icon size={17} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.type}</small>
                </span>
                <Command size={14} />
              </button>
            );
          })}
        </div>
        <footer>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
          <strong>Evidence first</strong>
        </footer>
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
