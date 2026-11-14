// Status pills (what is working, loading or broken) and issue messages (what is wrong, where,
// and what to do). Both are glass, and the colour says the state: green ok, violet loading,
// amber check this, red failed. What to show comes from health.ts.
import type { Issue, StatusPill } from "./health";
import styles from "./ReaderStatus.module.css";

export function StatusPills({ pills }: { pills: StatusPill[] }) {
  return (
    <ul className={styles.pills} aria-label="Status">
      {pills.map((p) => (
        <li key={p.id} className={styles.pill} data-tone={p.tone} title={p.detail}>
          {p.tone === "busy" ? (
            <span className={styles.ring} aria-hidden="true" />
          ) : (
            <span className={styles.dot} aria-hidden="true" />
          )}
          {p.label}
        </li>
      ))}
    </ul>
  );
}

const ICONS = {
  info: "M12 11v5M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  warn: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  error: "M12 8v5M12 16.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
} as const;

interface StackProps {
  issues: Issue[];
  onAction: (id: NonNullable<Issue["action"]>["id"]) => void;
  onDismiss: (id: string) => void;
}

export function IssueStack({ issues, onAction, onDismiss }: StackProps) {
  if (!issues.length) return null;
  return (
    <div className={styles.stack}>
      {issues.map((issue) => (
        // Errors are announced right away; the rest politely.
        <div
          key={issue.id}
          className={styles.issue}
          data-severity={issue.severity}
          role={issue.severity === "error" ? "alert" : "status"}
        >
          <span className={styles.icon} aria-hidden="true">
            {issue.busy ? (
              <span className={styles.ring} />
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={ICONS[issue.severity]} />
              </svg>
            )}
          </span>
          <div className={styles.body}>
            <strong className={styles.title}>{issue.title}</strong>
            {issue.detail && <span className={styles.detail}>{issue.detail}</span>}
            {issue.cause && <code className={styles.cause}>{issue.cause}</code>}
            {issue.action && (
              <button
                type="button"
                className={styles.action}
                onClick={() => onAction(issue.action?.id ?? "retry-hands")}
              >
                {issue.action.label}
              </button>
            )}
          </div>
          {issue.dismissible && (
            <button
              type="button"
              className={styles.close}
              onClick={() => onDismiss(issue.id)}
              aria-label="Dismiss"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
