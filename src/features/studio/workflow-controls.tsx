"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, LoaderCircle, RefreshCcw } from "lucide-react";
import type { WorkflowList } from "./workflow-api";

/**
 * Loading, refresh-failure, action-error, notice, and live-polling feedback for one workspace.
 *
 * The notice outlives the review screen it reports on: when `noticeFocusKey`
 * changes (a decision outcome), focus moves to the notice so it is not dropped
 * to <body> when the decided review screen unmounts.
 */
export function WorkspaceFeedback({ label, loading, busy, error, refreshError, notice, polling, onRetry, noticeFocusKey = 0 }: {
  label: string;
  loading: boolean;
  busy: boolean;
  error: string | null;
  refreshError: string | null;
  notice: string | null;
  polling: boolean;
  onRetry: () => void;
  noticeFocusKey?: number;
}) {
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (noticeFocusKey > 0) noticeRef.current?.focus(); }, [noticeFocusKey]);
  return <>
    {loading && <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Loading {label} workflows…</p>}
    {refreshError && <div className="refresh-error" role="alert"><AlertTriangle size={16} /> <span>{refreshError} The view may be out of date.</span><button type="button" className="button button-small" onClick={onRetry} disabled={busy}><RefreshCcw size={14} /> Retry now</button></div>}
    {error && <div className="error-banner" role="alert"><AlertTriangle size={17} /> {error}</div>}
    {notice && <div ref={noticeRef} className="notice-banner" role="status" tabIndex={-1}>{notice}</div>}
    {polling && <p className="poll-status"><LoaderCircle size={12} className="spin" /> Waiting on the workflow worker · checking for progress automatically</p>}
  </>;
}

/** The ledger of workflows of one type; the active one is marked with aria-pressed. */
export function RunChips({ label, workflows, activeId, disabled, onSelect }: {
  label: string;
  workflows: WorkflowList["workflows"];
  activeId?: string;
  disabled?: boolean;
  onSelect: (workflowId: string) => void;
}) {
  if (workflows.length === 0) return null;
  return (
    <nav className="chip-row" aria-label={label}>
      {workflows.map((item) => (
        <button key={item.id} type="button" className={`chip ${item.id === activeId ? "chip-active" : ""}`} aria-pressed={item.id === activeId} disabled={disabled} onClick={() => onSelect(item.id)}>
          {new Date(item.created_at).toLocaleDateString()} · {item.status.replaceAll("_", " ")}
        </button>
      ))}
    </nav>
  );
}

export function StageList({ steps }: { steps: Array<{ id: string; step_key: string; status: string; attempt_count: number; max_attempts: number; error_code: string | null }> }) {
  return (
    <ol className="stage-list" aria-label="Workflow stages">
      {steps.map((step) => (
        <li key={step.id} className={`stage stage-${step.status.toLowerCase()}`}>
          <span>{step.step_key.replaceAll("-", " ")}</span>
          <span className="muted">{step.status.replaceAll("_", " ")}{step.attempt_count > 1 ? ` · attempt ${step.attempt_count}/${step.max_attempts}` : ""}</span>
          {step.error_code && <code>{step.error_code}</code>}
        </li>
      ))}
    </ol>
  );
}
