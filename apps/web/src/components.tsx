import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import type {
  KnowledgeKind,
  ReviewerProfile,
  RiskLevel,
  Severity
} from "@lore/shared/types.js";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={clsx("brand", compact && "brand--compact")} aria-label="Lore">
      <svg className="brand__mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path d="M24 4 42 14 24 24 6 14 24 4Z" />
        <path d="m6 23 18 10 18-10M6 32l18 10 18-10M6 14v18M42 14v18" />
      </svg>
      {!compact && <span>Lore</span>}
    </div>
  );
}

export function Button({
  children,
  variant = "secondary",
  icon,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  icon?: ReactNode;
}) {
  return (
    <button className={clsx("button", `button--${variant}`, className)} {...props}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

export function Risk({ level }: { level: RiskLevel | "Blocked" }) {
  const normalised = level.toLowerCase();
  return (
    <span className={clsx("risk", `risk--${normalised}`)}>
      <span className="risk__dot" />
      {level[0]}
      {level.slice(1).toLowerCase()}
    </span>
  );
}

export function SeverityLabel({ severity }: { severity: Severity }) {
  return <span className={clsx("severity", `severity--${severity}`)}>{severity}</span>;
}

export function KindIcon({ kind }: { kind: KnowledgeKind }) {
  return (
    <span className={clsx("kind-icon", `kind-icon--${kind}`)} aria-hidden="true">
      {kind.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ReviewerAvatar({
  reviewer,
  size = "medium",
  className
}: {
  reviewer: Pick<ReviewerProfile, "name" | "providerIdentity" | "avatarUrl">;
  size?: "small" | "medium";
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const initials = reviewer.name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const showImage = Boolean(reviewer.avatarUrl && reviewer.avatarUrl !== failedUrl);

  return (
    <span
      className={clsx("reviewer-avatar", `reviewer-avatar--${size}`, className)}
      role="img"
      aria-label={`${reviewer.name} profile image`}
      title={`@${reviewer.providerIdentity}`}
    >
      <span aria-hidden="true">{initials}</span>
      {showImage ? (
        <img
          src={reviewer.avatarUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(reviewer.avatarUrl)}
        />
      ) : null}
    </span>
  );
}

export function Confidence({ value, label = true }: { value: number; label?: boolean }) {
  return (
    <span className="confidence">
      <span className="confidence__track">
        <span style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      {label && <strong>{Math.round(value * 100)}%</strong>}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  title,
  body,
  action
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__glyph">L</span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  footer,
  wide = false
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={clsx("modal", wide && "modal--wide")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header className="modal__header">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </section>
    </div>
  );
}

export function FormField({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Toast({
  message,
  tone = "success"
}: {
  message: string;
  tone?: "success" | "error";
}) {
  return (
    <div className={clsx("toast", `toast--${tone}`)} role="status">
      {message}
    </div>
  );
}
