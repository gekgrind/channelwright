"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, LoaderCircle, RefreshCcw, XCircle } from "lucide-react";
import type { ApprovalDecision, WorkflowList } from "./workflow-api";

/** Loading, refresh-failure, action-error, notice, and live-polling feedback for one workspace. */
export function WorkspaceFeedback({ label, loading, busy, error, refreshError, notice, polling, onRetry }: {
  label: string;
  loading: boolean;
  busy: boolean;
  error: string | null;
  refreshError: string | null;
  notice: string | null;
  polling: boolean;
  onRetry: () => void;
}) {
  return <>
    {loading && <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Loading {label} workflows…</p>}
    {refreshError && <div className="refresh-error" role="alert"><AlertTriangle size={16} /> <span>{refreshError} The view may be out of date.</span><button type="button" className="button button-small" onClick={onRetry} disabled={busy}><RefreshCcw size={14} /> Retry now</button></div>}
    {error && <div className="error-banner" role="alert"><AlertTriangle size={17} /> {error}</div>}
    {notice && <div className="notice-banner" role="status">{notice}</div>}
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

/**
 * The human decision gate shared by every production workflow.
 *
 * Approve stays one click and names the exact version it binds to. Request
 * revision needs a meaningful note. Reject is terminal in the engine (the
 * approval, run, and workflow are canceled), so it requires an explicit
 * confirmation that states that consequence before anything is sent.
 */
export function DecisionBar({ busy, title = "Human decision required", explanation, versionLabel, approveLabel, revisionPlaceholder, artifactLabel, onDecide }: {
  busy: boolean;
  title?: string;
  explanation: ReactNode;
  /** e.g. "Brief v2"; shown as the exact version an approval binds to. */
  versionLabel?: string;
  approveLabel: string;
  revisionPlaceholder: string;
  /** Lowercase noun for the reviewed artifact, e.g. "brief". */
  artifactLabel: string;
  onDecide: (decision: ApprovalDecision, note: string | undefined) => Promise<boolean>;
}) {
  const id = useId();
  const [revisionNote, setRevisionNote] = useState("");
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const rejectButton = useRef<HTMLButtonElement>(null);
  const keepReviewing = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const disabled = busy || submitting;

  // Focus the least destructive choice on open; return focus to Reject after a cancel.
  useEffect(() => {
    if (confirmingReject) keepReviewing.current?.focus();
    else if (restoreFocus.current) { restoreFocus.current = false; rejectButton.current?.focus(); }
  }, [confirmingReject]);

  const send = async (decision: ApprovalDecision, note: string | undefined) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const recorded = await onDecide(decision, note);
      if (recorded && decision === "REQUEST_REVISION") setRevisionNote("");
      if (recorded && decision === "REJECT") { setConfirmingReject(false); setRejectReason(""); }
    } finally {
      setSubmitting(false);
    }
  };

  const cancelReject = () => {
    restoreFocus.current = true;
    setConfirmingReject(false);
    setRejectReason("");
  };

  return (
    <section className="approval-panel" aria-labelledby={`${id}-title`}>
      <header>
        <p className="eyebrow">Your decision</p>
        <h3 id={`${id}-title`}>{title}</h3>
        <p className="muted">{explanation}</p>
        {versionLabel && <p className="version-binding">Approval binds to <b>{versionLabel}</b> exactly</p>}
      </header>
      <label>
        Revision note
        <textarea value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} maxLength={2000} rows={3}
          placeholder={revisionPlaceholder} disabled={disabled} />
      </label>
      <div className="button-row decision-actions">
        <button type="button" className="button button-accent" onClick={() => { setConfirmingReject(false); void send("APPROVE", undefined); }} disabled={disabled}><Check size={15} /> {approveLabel}</button>
        <button type="button" className="button" onClick={() => { setConfirmingReject(false); void send("REQUEST_REVISION", revisionNote.trim()); }} disabled={disabled || !revisionNote.trim()}><RefreshCcw size={15} /> Request revision</button>
        <button ref={rejectButton} type="button" className="button button-danger" onClick={() => setConfirmingReject(true)} disabled={disabled || confirmingReject} aria-expanded={confirmingReject} aria-controls={`${id}-reject`}><XCircle size={15} /> Reject…</button>
      </div>
      {confirmingReject && (
        <div id={`${id}-reject`} className="reject-confirm" role="alertdialog" aria-labelledby={`${id}-reject-title`} aria-describedby={`${id}-reject-body`}
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); cancelReject(); } }}>
          <h4 id={`${id}-reject-title`}><AlertTriangle size={17} /> Reject and close this {artifactLabel}?</h4>
          <p id={`${id}-reject-body`}>This run stays in the ledger as rejected, but it can no longer be approved or revised, and the workflow is closed. To try again, start a new {artifactLabel} from its approved upstream.</p>
          <label>
            Reason <small>Optional · saved with the decision</small>
            <textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={2000} rows={2} disabled={disabled}
              placeholder="Why is this direction being closed?" />
          </label>
          <div className="button-row">
            <button type="button" className="button button-danger-solid" onClick={() => void send("REJECT", rejectReason.trim() || undefined)} disabled={disabled}><XCircle size={15} /> Reject and close</button>
            <button ref={keepReviewing} type="button" className="button" onClick={cancelReject} disabled={submitting}>Keep reviewing</button>
          </div>
        </div>
      )}
    </section>
  );
}
