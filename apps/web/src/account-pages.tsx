import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Building2,
  Check,
  Copy,
  Github,
  LogOut,
  Mail,
  MapPin,
  ShieldCheck,
  UserRound,
  UsersRound
} from "lucide-react";
import type {
  AccountSession,
  AuthSessionSummary,
  OrganisationAccess,
  OrganisationRole,
  UserProfile
} from "@lore/shared/types.js";
import { Brand, Button, FormField, PageHeader } from "./components.js";
import { loreApi, type OrganisationDetails } from "./api.js";

export function LoginPage({
  demoMode,
  githubLoginEnabled,
  onDemoLogin
}: {
  demoMode: boolean;
  githubLoginEnabled: boolean;
  onDemoLogin: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const githubLogin = () => window.location.assign("/api/auth/github");
  const demoLogin = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onDemoLogin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Demo sign-in failed");
      setBusy(false);
    }
  };
  return (
    <main className="login-shell">
      <section className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">Engineering memory that can show its work</span>
          <h1>Your team’s decisions, evidence, and safeguards—ready when the next change begins.</h1>
          <p>
            Lore turns pull requests, reviews, incidents, documentation, and team communication
            into governed context for engineers and coding agents.
          </p>
        </div>
        <ul>
          <li><ShieldCheck size={18} /><span><strong>Private by organisation</strong> Every repository, rule, and evidence item stays inside an organisation boundary.</span></li>
          <li><Github size={18} /><span><strong>One trusted identity</strong> Sign in with GitHub; Lore never stores the short-lived login access token.</span></li>
          <li><UsersRound size={18} /><span><strong>Built for real teams</strong> Create organisations, invite colleagues, and assign least-privilege roles.</span></li>
        </ul>
        <small>Evidence-backed engineering memory · Local-first today · SaaS-ready foundations</small>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <span className="login-card__mark"><Github size={24} /></span>
          <h2>Welcome to Lore</h2>
          <p>Use your GitHub account to create a private workspace or join an existing team.</p>
          {githubLoginEnabled ? (
            <Button variant="primary" icon={<Github size={18} />} onClick={githubLogin}>Continue with GitHub</Button>
          ) : demoMode ? (
            <Button variant="primary" icon={<UserRound size={18} />} disabled={busy} onClick={() => void demoLogin()}>
              {busy ? "Signing in…" : "Explore the demo account"}
            </Button>
          ) : (
            <div className="auth-setup-note">
              <strong>GitHub sign-in needs configuring</strong>
              <p>Add <code>GITHUB_OAUTH_CLIENT_ID</code> and <code>GITHUB_OAUTH_CLIENT_SECRET</code>, then restart Lore.</p>
            </div>
          )}
          {githubLoginEnabled && demoMode && (
            <button className="login-demo-link" disabled={busy} onClick={() => void demoLogin()}>
              {busy ? "Signing in…" : "Or use the local demo account"}
            </button>
          )}
          {error && <div className="form-error">{error}</div>}
          <div className="login-trust">
            <ShieldCheck size={16} />
            <span>GitHub proves your identity. Repository access is configured separately and is never granted by signing in.</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function OrganisationForm({ onCreate }: { onCreate: (input: { name: string; slug: string }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const suggestedSlug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await onCreate({ name, slug });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Organisation could not be created");
      setBusy(false);
    }
  };
  return (
    <form className="organisation-create form-stack" onSubmit={(event) => void submit(event)}>
      <div className="form-grid">
        <FormField label="Organisation name" hint="The team or company name shown throughout Lore.">
          <input required value={name} placeholder="Acme Engineering" onChange={(event) => {
            setName(event.target.value);
            if (!slugEdited) setSlug(suggestedSlug(event.target.value));
          }} />
        </FormField>
        <FormField label="Organisation URL" hint={`lore.local/${slug || "acme-engineering"}`}>
          <input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} placeholder="acme-engineering" onChange={(event) => {
            setSlugEdited(true);
            setSlug(suggestedSlug(event.target.value));
          }} />
        </FormField>
      </div>
      {error && <div className="form-error">{error}</div>}
      <Button type="submit" variant="primary" icon={<Building2 size={17} />} disabled={busy || name.length < 2 || slug.length < 2}>
        {busy ? "Creating…" : "Create private organisation"}
      </Button>
    </form>
  );
}

export function OrganisationOnboardingPage({ session, onRefresh }: { session: AccountSession; onRefresh: () => Promise<void> }) {
  const accept = async (id: string) => {
    await loreApi.acceptInvitation(id);
    await onRefresh();
  };
  return (
    <main className="onboarding-shell">
      <header><Brand /><span>Signed in as <strong>{session.user?.name}</strong></span></header>
      <section>
        <span className="onboarding-glyph"><Building2 size={28} /></span>
        <h1>Give your engineering memory a home</h1>
        <p>Create a private organisation for your team, or accept an invitation sent to <strong>{session.user?.email}</strong>.</p>
        {session.pendingInvitations.length > 0 && (
          <div className="pending-invitations">
            <h2>Your invitations</h2>
            {session.pendingInvitations.map((invitation) => (
              <article key={invitation.id}>
                <Mail size={19} />
                <div><strong>{invitation.organisationName}</strong><span>Invited by {invitation.invitedByName} as {invitation.role}</span></div>
                <Button variant="secondary" onClick={() => void accept(invitation.id)}>Join organisation</Button>
              </article>
            ))}
          </div>
        )}
        <div className="onboarding-create">
          <h2>Create a new organisation</h2>
          <p>You will be its owner and can invite the rest of your team afterwards.</p>
          <OrganisationForm onCreate={async (input) => { await loreApi.createOrganisation(input); await onRefresh(); }} />
        </div>
      </section>
    </main>
  );
}

export function ProfilePage({
  profile,
  onUpdated,
  onLogout
}: {
  profile: UserProfile;
  onUpdated: (profile: UserProfile) => void;
  onLogout: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(profile);
  const [sessions, setSessions] = useState<AuthSessionSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  useEffect(() => { void loreApi.authSessions().then((result) => setSessions(result.items)); }, []);
  const set = (field: keyof UserProfile, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      const updated = await loreApi.updateProfile({
        name: draft.name, bio: draft.bio ?? "", company: draft.company ?? "", jobTitle: draft.jobTitle ?? "",
        location: draft.location ?? "", websiteUrl: draft.websiteUrl ?? "", timezone: draft.timezone ?? ""
      });
      setDraft(updated);
      onUpdated(updated);
      setMessage("Profile saved");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Profile could not be saved");
    } finally {
      setBusy(false);
    }
  };
  const initials = profile.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="page-pad account-page">
      <PageHeader title="Your profile" description="Personal details follow you across every organisation you join." />
      <div className="account-layout">
        <aside className="profile-summary">
          {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : <span>{initials}</span>}
          <h2>{profile.name}</h2>
          <p>@{profile.githubLogin ?? "github"}</p>
          <dl>
            <div><Mail size={15} /><span>{profile.email}<small>Verified by GitHub</small></span></div>
            {profile.location && <div><MapPin size={15} /><span>{profile.location}</span></div>}
            <div><Github size={15} /><a href={profile.githubProfileUrl} target="_blank" rel="noreferrer">GitHub profile</a></div>
          </dl>
        </aside>
        <div className="account-sections">
          <form onSubmit={(event) => void save(event)}>
            <header><h2>Personal details</h2><p>GitHub seeds these fields on first sign-in. Your edits are not overwritten later.</p></header>
            <div className="form-grid">
              <FormField label="Display name"><input required value={draft.name} onChange={(event) => set("name", event.target.value)} /></FormField>
              <FormField label="Job title"><input value={draft.jobTitle ?? ""} onChange={(event) => set("jobTitle", event.target.value)} /></FormField>
              <FormField label="Company"><input value={draft.company ?? ""} onChange={(event) => set("company", event.target.value)} /></FormField>
              <FormField label="Location"><input value={draft.location ?? ""} onChange={(event) => set("location", event.target.value)} /></FormField>
              <FormField label="Website"><input type="url" value={draft.websiteUrl ?? ""} onChange={(event) => set("websiteUrl", event.target.value)} /></FormField>
              <FormField label="Timezone"><input value={draft.timezone ?? ""} placeholder="Europe/London" onChange={(event) => set("timezone", event.target.value)} /></FormField>
            </div>
            <FormField label="Bio"><textarea maxLength={500} value={draft.bio ?? ""} onChange={(event) => set("bio", event.target.value)} /></FormField>
            <footer><span>{message}</span><Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</Button></footer>
          </form>
          <section className="security-section">
            <header><h2>Account security</h2><p>Lore sessions are revocable and expire automatically. GitHub tokens are never retained after sign-in.</p></header>
            {sessions.map((session) => (
              <div className="security-session" key={session.id}>
                <ShieldCheck size={17} /><span><strong>{session.current ? "This session" : "Active session"}</strong><small>Last active {new Date(session.lastSeenAt).toLocaleString()} · expires {new Date(session.expiresAt).toLocaleString()}</small></span>
              </div>
            ))}
            <footer>
              <Button variant="secondary" onClick={() => void loreApi.revokeOtherSessions().then((result) => { setSessions((items) => items.filter((item) => item.current)); setMessage(`${result.revoked} other session(s) signed out`); })}>Sign out other sessions</Button>
              <Button variant="danger" icon={<LogOut size={16} />} onClick={() => void onLogout()}>Sign out</Button>
            </footer>
          </section>
        </div>
      </div>
    </div>
  );
}

export function OrganisationsPage({ session, onRefresh }: { session: AccountSession; onRefresh: () => Promise<void> }) {
  const [details, setDetails] = useState<OrganisationDetails>();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<OrganisationRole, "owner">>("member");
  const [inviteUrl, setInviteUrl] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string>();
  const active = session.activeOrganisation;
  const canManage = active?.role === "owner" || active?.role === "admin";
  const load = async () => {
    if (!active) return;
    setDetails(await loreApi.organisation(active.id));
  };
  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Organisation could not be loaded")); }, [active?.id]);
  const invite = async (event: FormEvent) => {
    event.preventDefault();
    if (!active) return;
    setError(undefined);
    try {
      const created = await loreApi.inviteMember(active.id, { email: inviteEmail, role: inviteRole });
      setInviteUrl(created.inviteUrl);
      setInviteEmail("");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Invitation could not be created"); }
  };
  const switchOrganisation = async (organisation: OrganisationAccess) => {
    if (organisation.id === active?.id) return;
    await loreApi.switchOrganisation(organisation.id);
    await onRefresh();
  };
  const pending = session.pendingInvitations;
  const roleDescription = useMemo(() => ({
    owner: "Full control, including organisation settings and access.",
    admin: "Manages members and all engineering memory.",
    member: "Creates and updates engineering memory and repositories.",
    viewer: "Read-only access to the organisation."
  }), []);
  return (
    <div className="page-pad organisations-page">
      <PageHeader
        title="Organisations & access"
        description="Switch workspaces, invite colleagues, and keep access least-privileged."
        actions={<Button variant="primary" icon={<Building2 size={17} />} onClick={() => setShowCreate((value) => !value)}>New organisation</Button>}
      />
      {showCreate && <section className="organisation-create-panel"><h2>Create another organisation</h2><OrganisationForm onCreate={async (input) => { await loreApi.createOrganisation(input); await onRefresh(); }} /></section>}
      {pending.length > 0 && <section className="organisation-card pending-invitations"><h2>Invitations for you</h2>{pending.map((invitation) => <article key={invitation.id}><Mail size={18} /><div><strong>{invitation.organisationName}</strong><span>{invitation.invitedByName} invited you as {invitation.role}</span></div><Button onClick={() => void loreApi.acceptInvitation(invitation.id).then(onRefresh)}>Accept</Button></article>)}</section>}
      <div className="organisations-layout">
        <aside className="organisation-list">
          <h2>Your organisations</h2>
          {session.organisations.map((organisation) => (
            <button className={organisation.id === active?.id ? "is-active" : ""} key={organisation.id} onClick={() => void switchOrganisation(organisation)}>
              <span>{organisation.name.slice(0, 1).toUpperCase()}</span>
              <div><strong>{organisation.name}</strong><small>{organisation.memberCount} member{organisation.memberCount === 1 ? "" : "s"} · {organisation.role}</small></div>
              {organisation.id === active?.id && <Check size={16} />}
            </button>
          ))}
        </aside>
        <section className="organisation-workspace">
          {details && (
            <>
              <header><div><span className="eyebrow">Active organisation</span><h2>{details.organisation.name}</h2><p>{roleDescription[details.organisation.role]}</p></div><span className={`role-pill role-pill--${details.organisation.role}`}>{details.organisation.role}</span></header>
              {canManage && (
                <form className="invite-form" onSubmit={(event) => void invite(event)}>
                  <div><h3>Invite a colleague</h3><p>They must sign in with a GitHub account that owns this verified email address.</p></div>
                  <input type="email" required placeholder="engineer@company.com" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
                  <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Exclude<OrganisationRole, "owner">)}><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option></select>
                  <Button type="submit" variant="primary">Create invitation</Button>
                </form>
              )}
              {inviteUrl && <div className="invite-link"><span><strong>Invitation ready</strong><code>{inviteUrl}</code></span><Button icon={copied ? <Check size={15} /> : <Copy size={15} />} onClick={() => { void navigator.clipboard.writeText(inviteUrl); setCopied(true); }}>Copy link</Button></div>}
              {error && <div className="form-error">{error}</div>}
              <section className="member-section">
                <h3>Members</h3>
                <div className="member-table">
                  {details.members.map((member) => (
                    <article key={member.userId}>
                      {member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : <span className="member-avatar">{member.name.slice(0, 2).toUpperCase()}</span>}
                      <div><strong>{member.name}</strong><small>{member.email}{member.githubLogin ? ` · @${member.githubLogin}` : ""}</small></div>
                      {canManage && member.role !== "owner" ? (
                        <select aria-label={`Role for ${member.name}`} value={member.role} onChange={(event) => void loreApi.updateMemberRole(active!.id, member.userId, event.target.value as Exclude<OrganisationRole, "owner">).then(load)}><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option></select>
                      ) : <span className={`role-pill role-pill--${member.role}`}>{member.role}</span>}
                      {canManage && member.role !== "owner" ? <button className="remove-member" onClick={() => void loreApi.removeMember(active!.id, member.userId).then(load)}>Remove</button> : <span />}
                    </article>
                  ))}
                </div>
              </section>
              {canManage && details.invitations.length > 0 && <section className="member-section"><h3>Pending invitations</h3><div className="member-table">{details.invitations.map((invitation) => <article key={invitation.id}><span className="member-avatar"><Mail size={15} /></span><div><strong>{invitation.email}</strong><small>Invited by {invitation.invitedByName} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</small></div><span className={`role-pill role-pill--${invitation.role}`}>{invitation.role}</span><button className="remove-member" onClick={() => void loreApi.revokeInvitation(active!.id, invitation.id).then(load)}>Revoke</button></article>)}</div></section>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
