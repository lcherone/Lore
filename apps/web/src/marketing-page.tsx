import {
  ArrowRight,
  BookOpen,
  Check,
  GitPullRequest,
  MessageSquareText,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { Brand } from "./components.js";

const projectUrl = "https://github.com/lcherone/Lore";
const documentationUrl = `${projectUrl}#readme`;

const workflow = [
  {
    number: "01",
    title: "Observe evidence",
    copy: "Import pull requests, reviews, incidents, documentation, code structure, and team communication."
  },
  {
    number: "02",
    title: "Propose knowledge",
    copy: "AI extracts candidate decisions, conventions, risks, and conflicts with a traceable evidence chain."
  },
  {
    number: "03",
    title: "Review together",
    copy: "Engineers approve, edit, reject, or supersede proposals before they become trusted memory."
  },
  {
    number: "04",
    title: "Apply and verify",
    copy: "Developers and agents prepare scoped context, then record the checks that prove a change is safe."
  }
] as const;

function ProductScreenshot({
  src,
  alt,
  className = "",
  priority = false
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <figure className={`marketing-product-frame ${className}`.trim()}>
      <div className="marketing-product-frame__bar" aria-hidden="true">
        <span />
        <span />
        <span />
        <small>lore.local</small>
      </div>
      <img
        src={src}
        alt={alt}
        width={1440}
        height={src.includes("communication-evidence") ? 1500 : 1000}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
      />
    </figure>
  );
}

function MarketingHeader() {
  return (
    <header className="marketing-header">
      <div className="marketing-container marketing-header__inner">
        <a className="marketing-brand-link" href="/" aria-label="Lore homepage">
          <Brand />
        </a>
        <nav className="marketing-nav" aria-label="Main navigation">
          <a href="#product">Product</a>
          <a href="#how-it-works">How it works</a>
          <a href="#security">Security</a>
          <a href={documentationUrl} target="_blank" rel="noreferrer">Documentation</a>
        </nav>
        <div className="marketing-header__actions">
          <a className="marketing-signin-link" href="/signin">Sign in</a>
          <a className="marketing-button marketing-button--primary marketing-header__cta" href="/signin">
            Explore Lore <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </header>
  );
}

function HeroSection() {
  return (
    <section className="marketing-hero" aria-labelledby="marketing-hero-title">
      <div className="marketing-container marketing-hero__grid">
        <div className="marketing-hero__copy">
          <h1 id="marketing-hero-title">Engineering memory your team can trust.</h1>
          <p>
            Lore turns pull requests, reviews, incidents, documentation, code structure, and team
            decisions into evidence-backed context for developers and AI coding agents.
          </p>
          <div className="marketing-hero__actions">
            <a className="marketing-button marketing-button--primary" href="/signin">
              Explore Lore <ArrowRight size={17} />
            </a>
            <a className="marketing-button marketing-button--secondary" href={documentationUrl} target="_blank" rel="noreferrer">
              <BookOpen size={16} /> View documentation
            </a>
          </div>
          <div className="marketing-proof">
            <span><ShieldCheck size={17} /> Evidence in. Human-approved knowledge out.</span>
            <span><Check size={17} /> Runs locally with your own GitHub and OpenAI credentials.</span>
          </div>
        </div>
        <div className="marketing-hero__product" aria-label="Lore product dashboard preview">
          <span className="marketing-hero__annotation marketing-hero__annotation--top">
            <Sparkles size={15} /> AI proposes
          </span>
          <ProductScreenshot
            src="/product/lore-dashboard.png"
            alt="Lore dashboard showing connected repositories, governed knowledge, candidate decisions, and safety reports"
            className="marketing-product-frame--hero"
            priority
          />
          <span className="marketing-hero__annotation marketing-hero__annotation--bottom">
            <ShieldCheck size={15} /> Your team decides
          </span>
        </div>
      </div>
      <div className="marketing-container marketing-source-strip" aria-label="Lore evidence sources">
        <span>Built for the context already spread across</span>
        <strong>Pull requests</strong>
        <strong>Code</strong>
        <strong>Incidents</strong>
        <strong>Documentation</strong>
        <strong>Team communication</strong>
      </div>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section className="marketing-section marketing-workflow" id="how-it-works" aria-labelledby="workflow-title">
      <div className="marketing-container">
        <div className="marketing-section-heading">
          <h2 id="workflow-title">From evidence to trusted context.</h2>
          <p>
            Lore keeps authority separate from automation. Evidence is observed, AI proposes,
            people decide, and every change can be verified.
          </p>
        </div>
        <ol className="marketing-workflow__steps">
          {workflow.map((step) => (
            <li key={step.number}>
              <span>{step.number}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="marketing-workflow__product">
          <div className="marketing-workflow__note">
            <span>Review before authority</span>
            <strong>Every candidate keeps its sources, confidence, and comparison with current knowledge.</strong>
          </div>
          <ProductScreenshot
            src="/product/lore-candidate-review.png"
            alt="Lore candidate review screen showing an AI-proposed engineering decision and its supporting evidence"
          />
        </div>
      </div>
    </section>
  );
}

function CapabilitiesSection() {
  return (
    <section className="marketing-section marketing-capabilities" id="product" aria-labelledby="capabilities-title">
      <div className="marketing-container">
        <div className="marketing-section-heading marketing-section-heading--wide">
          <h2 id="capabilities-title">Keep the decisions behind the code.</h2>
          <p>
            Searchable engineering memory only helps when its claims stay connected to their source,
            their owner, and the safeguards that apply next time.
          </p>
        </div>

        <article className="marketing-feature-row">
          <div className="marketing-feature-copy">
            <GitPullRequest size={25} />
            <h3>GitHub memory that stays current</h3>
            <p>
              Connect a repository, import its complete pull-request history, and keep new evidence
              arriving on a schedule. Lore preserves discussions, reviews, commits, files, and the
              exact source behind every extracted claim.
            </p>
            <ul>
              <li><Check size={15} /> Token-backed local repository discovery</li>
              <li><Check size={15} /> Automatic historical and recurring PR imports</li>
              <li><Check size={15} /> Evidence lineage down to the source record</li>
            </ul>
          </div>
          <ProductScreenshot
            src="/product/lore-dashboard.png"
            alt="Lore dashboard summarising repositories and evidence-backed engineering activity"
          />
        </article>

        <article className="marketing-feature-row marketing-feature-row--reverse">
          <div className="marketing-feature-copy">
            <MessageSquareText size={25} />
            <h3>Turn communication into reviewable evidence</h3>
            <p>
              Paste a Slack thread, stand-up transcript, call note, or in-person decision. AI finds
              the useful engineering statements, improves their wording, and compares each one with
              existing evidence before it can change team memory.
            </p>
            <ul>
              <li><Check size={15} /> Long transcript and ad-hoc note analysis</li>
              <li><Check size={15} /> Duplicate, support, and conflict detection</li>
              <li><Check size={15} /> Human approval before knowledge changes</li>
            </ul>
          </div>
          <ProductScreenshot
            src="/product/lore-communication-evidence.png"
            alt="Lore communication evidence screen for analysing stand-ups, Slack threads, and call notes"
          />
        </article>

        <article className="marketing-feature-row">
          <div className="marketing-feature-copy">
            <ShieldCheck size={25} />
            <h3>Give every change context and safety</h3>
            <p>
              Prepare a task-specific context package for an engineer or coding agent. Lore selects
              relevant knowledge, policies, reviewers, and repository structure, then records the
              verification expected before the work is considered safe.
            </p>
            <ul>
              <li><Check size={15} /> CLI, API, and MCP access to the same authority</li>
              <li><Check size={15} /> Organisation-scoped policies and reviewer guidance</li>
              <li><Check size={15} /> Auditable change-safety reports</li>
            </ul>
          </div>
          <ProductScreenshot
            src="/product/lore-safety-report.png"
            alt="Lore safety report showing policy, knowledge, verification, and reviewer checks for an engineering change"
          />
        </article>
      </div>
    </section>
  );
}

function TrustSection() {
  return (
    <section className="marketing-trust-band" id="security" aria-labelledby="trust-title">
      <div className="marketing-container marketing-trust-band__grid">
        <div>
          <h2 id="trust-title">Built local-first. Designed for governed teams.</h2>
          <p>
            Start on one workstation with your own credentials and durable local data. The same
            product boundaries support multiple users, organisations, scoped roles, invitations,
            retention controls, and SaaS deployment when your policies allow it.
          </p>
          <a href={`${projectUrl}/blob/master/docs/security.md`} target="_blank" rel="noreferrer">
            Read the security model <ArrowRight size={15} />
          </a>
        </div>
        <dl>
          <div><dt>Authority</dt><dd>Human approval</dd></div>
          <div><dt>Traceability</dt><dd>Evidence provenance</dd></div>
          <div><dt>Privacy</dt><dd>Organisation boundaries</dd></div>
          <div><dt>Lifecycle</dt><dd>Configurable retention</dd></div>
        </dl>
      </div>
    </section>
  );
}

function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <section className="marketing-cta" aria-labelledby="marketing-cta-title">
        <div className="marketing-container marketing-cta__inner">
          <div>
            <h2 id="marketing-cta-title">Stop relearning the same engineering decisions.</h2>
            <p>
              Give your team and its tools governed context that gets better with every reviewed change.
            </p>
          </div>
          <div>
            <a className="marketing-button marketing-button--light" href="/signin">
              Explore Lore <ArrowRight size={17} />
            </a>
            <a className="marketing-button marketing-button--dark-outline" href={documentationUrl} target="_blank" rel="noreferrer">
              Read documentation
            </a>
            <small>Run locally with one GitHub personal access token.</small>
          </div>
        </div>
      </section>
      <div className="marketing-container marketing-footer__main">
        <div className="marketing-footer__brand">
          <Brand />
          <p>Evidence-backed engineering memory for developers and AI coding agents.</p>
        </div>
        <div className="marketing-footer__links">
          <div>
            <strong>Product</strong>
            <a href="#how-it-works">How it works</a>
            <a href="#product">Capabilities</a>
            <a href="#security">Security</a>
          </div>
          <div>
            <strong>Developers</strong>
            <a href={documentationUrl} target="_blank" rel="noreferrer">Documentation</a>
            <a href={`${projectUrl}/blob/master/docs/github.md`} target="_blank" rel="noreferrer">GitHub setup</a>
            <a href={`${projectUrl}/blob/master/docs/mcp.md`} target="_blank" rel="noreferrer">MCP setup</a>
          </div>
          <div>
            <strong>Project</strong>
            <a href={projectUrl} target="_blank" rel="noreferrer">GitHub</a>
            <a href={`${projectUrl}/blob/master/docs/roadmap.md`} target="_blank" rel="noreferrer">Roadmap</a>
            <a href={`${projectUrl}/blob/master/docs/saas-readiness.md`} target="_blank" rel="noreferrer">SaaS readiness</a>
          </div>
        </div>
      </div>
      <div className="marketing-container marketing-footer__legal">
        <span>© {new Date().getFullYear()} Lore. Source-available engineering infrastructure.</span>
        <a href="/signin">Sign in</a>
      </div>
    </footer>
  );
}

export function MarketingPage() {
  return (
    <div className="marketing-page">
      <a className="marketing-skip-link" href="#marketing-main">Skip to content</a>
      <MarketingHeader />
      <main id="marketing-main">
        <HeroSection />
        <WorkflowSection />
        <CapabilitiesSection />
        <TrustSection />
      </main>
      <MarketingFooter />
    </div>
  );
}
