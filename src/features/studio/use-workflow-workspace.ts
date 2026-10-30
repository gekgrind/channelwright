"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  announceWorkflowsChanged,
  currentRunOf,
  decisionFailureOf,
  decisionTargetOf,
  fetchWorkflowDetail,
  fetchWorkflowList,
  onWorkflowsChanged,
  pendingApprovalOf,
  POLLING_WORKFLOW_STATUSES,
  startWorkflow,
  submitApprovalDecision,
  WORKFLOW_POLL_INTERVAL_MS,
  type ApprovalDecision,
  type DecisionOutcome,
  type DecisionTarget,
  type WorkflowDetailBase,
  type WorkflowList,
} from "./workflow-api";

const messageOf = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;

/**
 * Shared list/detail/polling/decision behavior for one production workflow type.
 *
 * - Loads the workflow list (unless the parent already supplied it) and the
 *   newest workflow's detail.
 * - Polls the selected workflow only while a worker is advancing it.
 * - Keeps refresh failures visible (refreshError) instead of swallowing them.
 * - Starts and decisions announce the change so sibling workspaces re-read the
 *   list and can see newly approved upstream artifacts.
 * - Decisions are bound to an exact workflow/run/approval target and are only
 *   sent while that target is still the selected, committed one, at most once
 *   at a time per target.
 * - After a recorded or unconfirmed decision the target is locked until a
 *   detail load that started afterwards succeeds, so a stale pending view can
 *   never be decided on again.
 */
export function useWorkflowWorkspace<TDetail extends WorkflowDetailBase>({ initial, workflowType, label }: {
  initial?: WorkflowList;
  workflowType: string;
  /** Human wording used in fallback messages, e.g. "video brief". */
  label: string;
}) {
  const source = useId();
  const [engine, setEngine] = useState(initial);
  const [detail, setDetail] = useState<TDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // True between choosing another workflow and receiving its detail; the
  // previous workflow's detail is cleared so it cannot be acted on meanwhile.
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const mounted = useRef(true);
  const selectedId = useRef<string | undefined>(undefined);
  // The newest committed detail, used to verify decision targets at send time.
  const detailRef = useRef<TDetail | null>(null);
  const requestSeq = useRef(0);
  // Every list fetch (full loads and sibling-triggered list refreshes) takes a
  // ticket; only the newest ticket may replace the list, so a slow older
  // response can never overwrite newer state.
  const listSeq = useRef(0);
  // Every operation that may set or clear refreshError takes a ticket too; only
  // the newest may change it, so an older success cannot erase a newer failure
  // and an older failure cannot overwrite a newer recovery.
  const feedbackSeq = useRef(0);
  const inFlight = useRef(0);
  // Decision targets currently being sent.
  const deciding = useRef(new Set<string>());
  // Locked target key → the load sequence at lock time; only a later load may clear it.
  const lockSeq = useRef(new Map<string, number>());
  const [lockedKeys, setLockedKeys] = useState<string[]>([]);
  // Bumped on each decision outcome notice so the workspace can move focus to it.
  const [noticeFocusKey, setNoticeFocusKey] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const workflows = useMemo(() => engine?.workflows.filter((item) => item.workflow_type === workflowType) ?? [], [engine, workflowType]);

  /** Resolves true only when this call committed a detail that is still the newest. */
  const load = useCallback(async (workflowId?: string, detailOnly = false): Promise<boolean> => {
    const seq = ++requestSeq.current;
    let selected = workflowId ?? selectedId.current;
    if (!detailOnly) {
      const listTicket = ++listSeq.current;
      const list = await fetchWorkflowList(`Could not refresh ${label} workflows.`);
      if (!mounted.current || seq !== requestSeq.current) return false;
      if (listTicket === listSeq.current) setEngine(list.workflowEngine);
      selected ??= list.workflowEngine.workflows.find((item) => item.workflow_type === workflowType)?.id;
    }
    if (!selected) return false;
    const next = await fetchWorkflowDetail<TDetail>(selected, `Could not load the ${label} workflow.`);
    if (!mounted.current || seq !== requestSeq.current) return false;
    selectedId.current = selected;
    detailRef.current = next;
    setDetail(next);
    setSwitchingTo(null);
    // This load started after any lock on this workflow it is newer than: the view now shows the server's state.
    const reconciled = [...lockSeq.current].filter(([key, lockedAt]) => key.startsWith(`${selected}:`) && seq > lockedAt).map(([key]) => key);
    if (reconciled.length > 0) {
      for (const key of reconciled) lockSeq.current.delete(key);
      setLockedKeys([...lockSeq.current.keys()]);
    }
    return true;
  }, [label, workflowType]);

  /**
   * Never throws: a failed refresh stays visible until a later one succeeds.
   * Resolves true only when this refresh committed the newest detail. A newer
   * detail load (another refresh, reload, or poll) supersedes it; a sibling's
   * list-only refresh does not, because it never replaces the detail.
   */
  const refresh = useCallback(async (workflowId?: string, detailOnly = false) => {
    const ticket = ++feedbackSeq.current;
    inFlight.current += 1;
    try {
      const committed = await load(workflowId, detailOnly);
      if (mounted.current && ticket === feedbackSeq.current) setRefreshError(null);
      return committed;
    } catch (cause) {
      if (mounted.current && ticket === feedbackSeq.current) setRefreshError(messageOf(cause, `Could not refresh ${label} workflows.`));
      return false;
    } finally {
      inFlight.current -= 1;
    }
  }, [label, load]);

  const refreshList = useCallback(async () => {
    const ticket = ++listSeq.current;
    const feedbackTicket = ++feedbackSeq.current;
    try {
      const list = await fetchWorkflowList(`Could not refresh ${label} workflows.`);
      if (mounted.current && ticket === listSeq.current) setEngine(list.workflowEngine);
      if (mounted.current && feedbackTicket === feedbackSeq.current) setRefreshError(null);
    } catch (cause) {
      if (mounted.current && feedbackTicket === feedbackSeq.current) setRefreshError(messageOf(cause, `Could not refresh ${label} workflows.`));
    }
  }, [label]);

  // Initial load. A parent-supplied list is already fresh, so only the newest
  // workflow's detail is fetched in that case.
  useEffect(() => {
    const initialId = initial?.workflows.find((item) => item.workflow_type === workflowType)?.id;
    const loadInitial = async () => {
      if (!initial) await refresh();
      else if (initialId) await refresh(initialId, true);
      if (mounted.current) setLoading(false);
    };
    void loadInitial();
    // Mount-only: later changes arrive through refresh, polling, or announcements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeId = detail?.workflow.id ?? switchingTo ?? workflows[0]?.id;
  const status = detail?.workflow.status;
  const polling = Boolean(detail && status && POLLING_WORKFLOW_STATUSES.includes(status));

  useEffect(() => {
    if (!polling || !activeId) return;
    const timer = setInterval(() => { if (inFlight.current === 0) void refresh(activeId); }, WORKFLOW_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [polling, activeId, refresh]);

  useEffect(() => onWorkflowsChanged((origin) => { if (origin !== source) void refreshList(); }), [refreshList, source]);

  const select = useCallback((workflowId: string) => {
    selectedId.current = workflowId;
    setNotice(null);
    if (detailRef.current?.workflow.id !== workflowId) {
      // Drop the previous workflow's detail so its review controls (and any
      // draft state bound to it) cannot act while the new selection loads.
      detailRef.current = null;
      setDetail(null);
      setSwitchingTo(workflowId);
    }
    void refresh(workflowId);
  }, [refresh]);

  const start = useCallback(async (input: unknown, successNotice: string) => {
    setBusy(true); setError(null); setNotice(null);
    let workflowId: string;
    try {
      workflowId = (await startWorkflow(workflowType, input, `Could not start the ${label}.`)).operationResult.workflowId;
    } catch (cause) {
      if (mounted.current) { setError(messageOf(cause, `Could not start the ${label}.`)); setBusy(false); }
      return false;
    }
    // The run exists from here on. A failed follow-up load is a refresh failure
    // (refreshError, with Retry), never a failed start: reporting it as one
    // would invite a second paid run under a fresh idempotency key.
    selectedId.current = workflowId;
    if (detailRef.current?.workflow.id !== workflowId) {
      detailRef.current = null;
      setDetail(null);
      setSwitchingTo(workflowId);
    }
    announceWorkflowsChanged(source);
    await refresh(workflowId);
    if (mounted.current) { setNotice(successNotice); setBusy(false); }
    return true;
  }, [label, refresh, source, workflowType]);

  const lock = useCallback((key: string) => {
    lockSeq.current.set(key, requestSeq.current);
    setLockedKeys([...lockSeq.current.keys()]);
  }, []);

  /**
   * Sends a decision only to the exact gate it was made against. The target is
   * re-verified against the currently selected, committed detail at send time;
   * if anything changed, nothing is sent. Failures are returned to the caller
   * (the review dialog shows them next to the control) and never reported as
   * success.
   */
  const decide = useCallback(async (target: DecisionTarget, decision: ApprovalDecision, note: string | undefined, successNotice: string): Promise<DecisionOutcome> => {
    const current = decisionTargetOf(detailRef.current);
    if (!current || current.key !== target.key || selectedId.current !== target.workflowId) {
      const message = "Nothing was recorded: the selected run changed before this decision was sent. Review the run now shown and decide again.";
      setError(message);
      return { ok: false, reason: "target-changed", message };
    }
    if (deciding.current.has(target.key)) return { ok: false, reason: "in-flight", message: "A decision on this version is already being sent." };
    if (lockSeq.current.has(target.key)) return { ok: false, reason: "unconfirmed", message: "A decision on this version was already sent. Reload to see its current state before deciding again." };
    if (decision === "REQUEST_REVISION" && !note?.trim()) return { ok: false, reason: "validation", message: "Nothing was recorded: a revision needs a note saying what should change." };
    deciding.current.add(target.key);
    setBusy(true); setError(null); setNotice(null);
    try {
      await submitApprovalDecision(target.workflowId, target.approvalId, decision, note?.trim() || undefined, "Could not record the review decision.");
    } catch (cause) {
      const failure = decisionFailureOf(cause);
      if (failure.reason === "unconfirmed" || failure.reason === "stale") lock(target.key);
      deciding.current.delete(target.key);
      if (mounted.current) setBusy(false);
      return { ok: false, ...failure };
    }
    deciding.current.delete(target.key);
    // Recorded. Until a later load shows the new state, this target cannot be
    // decided again. As with starts, a failed follow-up load is only a refresh failure.
    lock(target.key);
    announceWorkflowsChanged(source);
    if (!mounted.current) return { ok: true };
    if (selectedId.current === target.workflowId) {
      await refresh(target.workflowId);
      if (mounted.current) setNotice(successNotice);
    } else {
      // The operator moved on while the decision was in flight: record the
      // outcome without pulling the view back to the previous workflow.
      await refreshList();
      if (mounted.current) setNotice(`${decision.replaceAll("_", " ")} recorded on the previously selected workflow.`);
    }
    if (mounted.current) { setNoticeFocusKey((value) => value + 1); setBusy(false); }
    return { ok: true };
  }, [lock, refresh, refreshList, source]);

  /**
   * Re-reads the selected workflow to reconcile a locked or stale decision. The
   * reconciled state may remove the review screen that asked for it, so a
   * successful reload announces itself in the workspace notice and takes focus
   * there; a failed one stays visible as a refresh error.
   */
  const reload = useCallback(() => {
    void (async () => {
      setNotice(null);
      if (!await refresh(selectedId.current) || !mounted.current) return;
      setNotice("Reloaded. This view now shows the workflow's current state.");
      setNoticeFocusKey((value) => value + 1);
    })();
  }, [refresh]);

  const decisionTarget = decisionTargetOf(detail);

  return {
    engine,
    workflows,
    detail,
    currentRun: currentRunOf(detail),
    pendingApproval: pendingApprovalOf(detail),
    decisionTarget,
    /** The shown target was decided (or its outcome is unconfirmed) and has not been reconciled. */
    decisionLocked: Boolean(decisionTarget && lockedKeys.includes(decisionTarget.key)),
    noticeFocusKey,
    activeId,
    polling,
    loading,
    switching: switchingTo !== null,
    busy,
    error,
    refreshError,
    notice,
    setError,
    setNotice,
    refresh: async () => { await refresh(); },
    reload,
    select,
    start,
    decide,
  };
}
