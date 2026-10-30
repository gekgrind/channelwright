"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, LoaderCircle, RefreshCcw, XCircle } from "lucide-react";
import { ConfirmDialog } from "./review-dialog";
import { REVIEW_KINDS, reviewVersionLabel, type ReviewKind, type ReviewKindKey } from "./review-kinds";
import type { ApprovalDecision, DecisionOutcome, DecisionTarget } from "./workflow-api";

type ReviewScreenProps = {
  /** The workflow type under review; selects the verified consequence copy. */
  kind: ReviewKindKey;
  /** The exact workflow/run/approval this decision is bound to. */
  target: DecisionTarget;
  /** 1-based run position within its workflow ("v2"), when derivable. */
  versionNumber?: number;
  busy: boolean;
  title?: string;
  explanation: ReactNode;
  revisionPlaceholder?: string;
  /**
   * A decision on this exact target was recorded, or its outcome could not be
   * confirmed, and the view has not been reconciled since. Every action is
   * withheld until a reload shows the real state.
   */
  locked?: boolean;
  /** Always receives the target this screen was rendered for, never a newer selection. */
  onDecide: (target: DecisionTarget, decision: ApprovalDecision, note: string | undefined) => Promise<DecisionOutcome>;
  onReload: () => void;
};

/**
 * The one human decision region every review kind shares.
 *
 * Keyed by the decision target: when the selected workflow, run, or approval
 * changes, the screen remounts, so an open dialog, a typed note, a failure
 * message, or an in-flight submission can never carry over to another artifact.
 */
export function ReviewScreen(props: ReviewScreenProps) {
  return <ReviewScreenForTarget key={props.target.key} {...props} />;
}

type Pending = ApprovalDecision | null;
type Failure = Extract<DecisionOutcome, { ok: false }>;

/** Failures after which the same confirmation may be sent again from the dialog. */
const RETRYABLE = new Set<Failure["reason"]>(["validation", "unavailable", "rejected"]);

function ReviewScreenForTarget({ kind: kindKey, target, versionNumber, busy, title = "Your decision", explanation, revisionPlaceholder, locked = false, onDecide, onReload }: ReviewScreenProps) {
  const kind: ReviewKind = REVIEW_KINDS[kindKey];
  const label = reviewVersionLabel(kind, versionNumber);
  const id = useId();
  const [open, setOpen] = useState<Pending>(null);
  const [note, setNote] = useState("");
  const [noteInvalid, setNoteInvalid] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Synchronous guard: a second click or Enter repeat in the same tick, before
  // React re-renders the disabled state, still cannot send a second mutation.
  const sending = useRef(false);
  const restoreFocus = useRef(true);
  const approveButton = useRef<HTMLButtonElement>(null);
  const reviseButton = useRef<HTMLButtonElement>(null);
  const rejectButton = useRef<HTMLButtonElement>(null);
  const safeAction = useRef<HTMLButtonElement>(null);
  const confirmAction = useRef<HTMLButtonElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lockedReload = useRef<HTMLButtonElement>(null);
  // Where focus goes once the dialog has closed, when the invoker cannot take it
  // (it is disabled while the decision is locked).
  const focusAfterClose = useRef<HTMLElement | null>(null);
  const actionsDisabled = busy || submitting || locked;
  const confirmBlocked = submitting || (failure !== null && !RETRYABLE.has(failure.reason));

  const openDialog = (decision: ApprovalDecision) => {
    if (actionsDisabled) return;
    restoreFocus.current = true;
    setFailure(null);
    setNoteInvalid(false);
    setOpen(decision);
  };

  const close = () => {
    if (submitting) return;
    if (failure && !RETRYABLE.has(failure.reason) && failure.reason !== "unauthorized") {
      restoreFocus.current = false;
      focusAfterClose.current = lockedReload.current ?? heading.current;
    }
    setOpen(null);
    setFailure(null);
    setNoteInvalid(false);
  };

  const confirm = async () => {
    if (!open || sending.current || confirmBlocked) return;
    const decision = open;
    const text = decision === "REQUEST_REVISION" ? note.trim() : decision === "REJECT" ? reason.trim() : "";
    if (decision === "REQUEST_REVISION" && !text) { setNoteInvalid(true); noteField.current?.focus(); return; }
    sending.current = true;
    setSubmitting(true);
    setFailure(null);
    let outcome: DecisionOutcome;
    try {
      outcome = await onDecide(target, decision, text || undefined);
    } catch {
      outcome = { ok: false, reason: "unconfirmed", message: "Channelwright couldn't confirm whether this decision was recorded. Reload to see the current state before deciding again." };
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
    if (outcome.ok) {
      // The workspace's status notice takes focus; do not pull it back here.
      restoreFocus.current = false;
      setOpen(null);
      setNote("");
      setReason("");
      return;
    }
    setFailure(outcome);
    if (RETRYABLE.has(outcome.reason)) confirmAction.current?.focus();
    else safeAction.current?.focus();
  };

  const reload = () => {
    restoreFocus.current = false;
    focusAfterClose.current = heading.current;
    setOpen(null);
    setFailure(null);
    onReload();
  };

  // Runs after the dialog's own cleanup, so it wins over (skipped) invoker restoration.
  useEffect(() => {
    if (open !== null || !focusAfterClose.current) return;
    focusAfterClose.current.focus();
    focusAfterClose.current = null;
  }, [open]);

  const instruction = kind.revisionNoteReachesModel
    ? "with your note passed to the AI as its revision instruction."
    : "Your note is saved with the decision, but this stage does not currently pass it to the AI, so the new version may not reflect it.";
  const retrieval = kind.revisionRetrieves ? " It also repeats YouTube retrieval, which uses provider quota." : "";
  const dialogCopy: Record<ApprovalDecision, { title: string; body: ReactNode; confirmLabel: string; alert: boolean; tone: string }> = {
    APPROVE: {
      title: `Approve ${label}?`,
      body: <><p>{kind.approves}</p><p>Approval binds to <b>{label}</b> exactly and cannot be undone from Channelwright.</p></>,
      confirmLabel: `Approve ${label}`,
      alert: false,
      tone: "button-accent",
    },
    REQUEST_REVISION: {
      title: `Request a revision of ${label}?`,
      body: <>
        <p className="review-paid"><AlertTriangle size={15} aria-hidden="true" /> <span><b>This starts another AI generation run that uses paid model calls.</b> The whole {kind.noun} pipeline runs again{kind.revisionNoteReachesModel ? " " : ". "}{instruction}{retrieval} Channelwright does not estimate the cost.</span></p>
        <p>{label} is closed for review and stays in the ledger, read-only. The new version waits for your review when it finishes.</p>
      </>,
      confirmLabel: "Request revision and start a new run",
      alert: true,
      tone: "button-accent",
    },
    REJECT: {
      title: `Reject ${label}?`,
      body: <><p>{label} stays in the ledger as rejected, but it can no longer be approved or revised, and this workflow closes.</p><p>{kind.rejectKeeps}</p></>,
      confirmLabel: `Reject ${label}`,
      alert: true,
      tone: "button-danger-solid",
    },
  };
  const active = open ? dialogCopy[open] : null;
  // Approve and Reject open on Cancel; a revision opens in its required note.
  const initialFocus = open === "REQUEST_REVISION" ? noteField : safeAction;

  return (
    <section className="review-screen approval-panel" aria-labelledby={`${id}-title`} data-review-kind={kindKey}>
      <header>
        <p className="eyebrow">Your decision</p>
        <h3 id={`${id}-title`} ref={heading} tabIndex={-1}>{title}</h3>
        <p className="muted">{explanation}</p>
        <p className="version-binding">Approval binds to <b>{label}</b> exactly</p>
      </header>
      {locked && (
        <div className="review-locked" role="status">
          <p>A decision on {label} was sent, and this view has not been refreshed since. Reload to see its current state before deciding again.</p>
          <button ref={lockedReload} type="button" className="button button-small" onClick={onReload} disabled={busy}><RefreshCcw size={14} aria-hidden="true" /> Reload current state</button>
        </div>
      )}
      <div className="button-row decision-actions review-actions">
        <button ref={approveButton} type="button" className="button button-accent" data-review-action="approve" onClick={() => openDialog("APPROVE")} disabled={actionsDisabled} aria-haspopup="dialog"><Check size={15} aria-hidden="true" /> Approve {label}</button>
        <button ref={reviseButton} type="button" className="button" data-review-action="revise" onClick={() => openDialog("REQUEST_REVISION")} disabled={actionsDisabled} aria-haspopup="dialog"><RefreshCcw size={15} aria-hidden="true" /> Request revision…</button>
        <button ref={rejectButton} type="button" className="button button-danger" data-review-action="reject" onClick={() => openDialog("REJECT")} disabled={actionsDisabled} aria-haspopup="dialog"><XCircle size={15} aria-hidden="true" /> Reject…</button>
      </div>
      {open && active && (
        <ConfirmDialog
          title={active.title}
          description={active.body}
          alert={active.alert}
          dismissible={!submitting}
          onDismiss={close}
          initialFocus={initialFocus}
          returnFocus={open === "APPROVE" ? approveButton : open === "REJECT" ? rejectButton : reviseButton}
          restoreFocus={restoreFocus}
        >
          {open === "REQUEST_REVISION" && (
            <label className="review-field">
              What should change, and why? <small>{kind.revisionNoteReachesModel ? "Required · sent to the AI with the new run" : "Required · saved with the decision"}</small>
              <textarea ref={noteField} value={note} rows={4} maxLength={2000} placeholder={revisionPlaceholder}
                aria-invalid={noteInvalid || undefined} aria-describedby={noteInvalid ? `${id}-note-error` : undefined}
                onChange={(event) => { setNote(event.target.value); if (event.target.value.trim()) setNoteInvalid(false); }} readOnly={submitting} />
              {noteInvalid && <span id={`${id}-note-error`} className="review-field-error">Write what should change before requesting a revision.</span>}
            </label>
          )}
          {open === "REJECT" && (
            <label className="review-field">
              Reason <small>Optional · saved with the decision</small>
              <textarea value={reason} rows={3} maxLength={2000} placeholder="Why is this direction being closed?" onChange={(event) => setReason(event.target.value)} readOnly={submitting} />
            </label>
          )}
          <p className="review-dialog-status" role="status" aria-live="polite">{submitting ? `Sending your decision on ${label}…` : ""}</p>
          {failure && (
            <div className="review-dialog-error" role="alert">
              <p><AlertTriangle size={15} aria-hidden="true" /> {failure.message}</p>
              {!RETRYABLE.has(failure.reason) && failure.reason !== "unauthorized" && <button type="button" className="button button-small" onClick={reload}><RefreshCcw size={14} aria-hidden="true" /> Reload current state</button>}
            </div>
          )}
          <div className="button-row review-dialog-actions">
            <button ref={safeAction} type="button" className="button" onClick={close} aria-disabled={submitting || undefined}>{failure && !RETRYABLE.has(failure.reason) ? "Close" : "Cancel"}</button>
            <button ref={confirmAction} type="button" className={`button ${active.tone}`} onClick={() => void confirm()} aria-disabled={confirmBlocked || undefined}>
              {submitting ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : null} {active.confirmLabel}
            </button>
          </div>
        </ConfirmDialog>
      )}
    </section>
  );
}
