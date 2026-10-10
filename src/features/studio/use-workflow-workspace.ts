"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  announceWorkflowsChanged,
  currentRunOf,
  fetchWorkflowDetail,
  fetchWorkflowList,
  onWorkflowsChanged,
  pendingApprovalOf,
  POLLING_WORKFLOW_STATUSES,
  startWorkflow,
  submitApprovalDecision,
  WORKFLOW_POLL_INTERVAL_MS,
  type ApprovalDecision,
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
  const mounted = useRef(true);
  const selectedId = useRef<string | undefined>(undefined);
  const requestSeq = useRef(0);
  // Every list fetch (full loads and sibling-triggered list refreshes) takes a
  // ticket; only the newest ticket may replace the list, so a slow older
  // response can never overwrite newer state.
  const listSeq = useRef(0);
  const inFlight = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const workflows = useMemo(() => engine?.workflows.filter((item) => item.workflow_type === workflowType) ?? [], [engine, workflowType]);

  const load = useCallback(async (workflowId?: string, detailOnly = false) => {
    const seq = ++requestSeq.current;
    let selected = workflowId ?? selectedId.current;
    if (!detailOnly) {
      const listTicket = ++listSeq.current;
      const list = await fetchWorkflowList(`Could not refresh ${label} workflows.`);
      if (!mounted.current || seq !== requestSeq.current) return;
      if (listTicket === listSeq.current) setEngine(list.workflowEngine);
      selected ??= list.workflowEngine.workflows.find((item) => item.workflow_type === workflowType)?.id;
    }
    if (!selected) return;
    const next = await fetchWorkflowDetail<TDetail>(selected, `Could not load the ${label} workflow.`);
    if (!mounted.current || seq !== requestSeq.current) return;
    selectedId.current = selected;
    setDetail(next);
  }, [label, workflowType]);

  /** Never throws: a failed refresh stays visible until a later one succeeds. */
  const refresh = useCallback(async (workflowId?: string, detailOnly = false) => {
    inFlight.current += 1;
    try {
      await load(workflowId, detailOnly);
      if (mounted.current) setRefreshError(null);
    } catch (cause) {
      if (mounted.current) setRefreshError(messageOf(cause, `Could not refresh ${label} workflows.`));
    } finally {
      inFlight.current -= 1;
    }
  }, [label, load]);

  const refreshList = useCallback(async () => {
    const ticket = ++listSeq.current;
    try {
      const list = await fetchWorkflowList(`Could not refresh ${label} workflows.`);
      if (mounted.current && ticket === listSeq.current) { setEngine(list.workflowEngine); setRefreshError(null); }
    } catch (cause) {
      if (mounted.current && ticket === listSeq.current) setRefreshError(messageOf(cause, `Could not refresh ${label} workflows.`));
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

  const activeId = detail?.workflow.id ?? workflows[0]?.id;
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
    void refresh(workflowId);
  }, [refresh]);

  const start = useCallback(async (input: unknown, successNotice: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const payload = await startWorkflow(workflowType, input, `Could not start the ${label}.`);
      selectedId.current = payload.operationResult.workflowId;
      announceWorkflowsChanged(source);
      await load(payload.operationResult.workflowId);
      if (mounted.current) setNotice(successNotice);
      return true;
    } catch (cause) {
      if (mounted.current) setError(messageOf(cause, `Could not start the ${label}.`));
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [label, load, source, workflowType]);

  const decide = useCallback(async (decision: ApprovalDecision, note: string | undefined, successNotice: string) => {
    const approval = pendingApprovalOf(detail);
    if (!detail || !approval) return false;
    if (decision === "REQUEST_REVISION" && !note?.trim()) return false;
    setBusy(true); setError(null); setNotice(null);
    try {
      await submitApprovalDecision(detail.workflow.id, approval.id, decision, note?.trim() || undefined, "Could not record the review decision.");
      announceWorkflowsChanged(source);
      await load(detail.workflow.id);
      if (mounted.current) setNotice(successNotice);
      return true;
    } catch (cause) {
      if (mounted.current) setError(messageOf(cause, "Could not record the review decision."));
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [detail, load, source]);

  return {
    engine,
    workflows,
    detail,
    currentRun: currentRunOf(detail),
    pendingApproval: pendingApprovalOf(detail),
    activeId,
    polling,
    loading,
    busy,
    error,
    refreshError,
    notice,
    setError,
    setNotice,
    refresh: () => refresh(),
    select,
    start,
    decide,
  };
}
