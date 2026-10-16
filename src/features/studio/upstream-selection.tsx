"use client";

import { useEffect, useMemo, useState } from "react";
import { currentRunOf, fetchApprovedWorkflowPage, fetchWorkflowDetail, runVersionOf, type ApprovedWorkflowPage, type WorkflowDetailBase, type WorkflowList } from "./workflow-api";

type Describe<T> = (output: T) => { title: string; detail?: string };

/** The exact approved artifact the next start will consume. Only identifiers are ever sent. */
export type ApprovedUpstream<T> = {
  workflowId: string;
  runId: string;
  version?: number;
  approvedAt?: string | null;
  output: T;
  title: string;
  detail?: string;
};

/**
 * Lists approved (COMPLETED) workflows of one upstream type, defaults to the
 * newest, lets the operator choose another, and resolves the chosen workflow's
 * current run so the UI can show exactly what will be consumed. The server still
 * re-verifies approval and integrity on start; this never selects silently.
 */
export function useApprovedUpstream<T>({ engine, workflowType, label, parse, describe }: {
  engine?: WorkflowList;
  workflowType: string;
  /** Lowercase noun, e.g. "video script". */
  label: string;
  parse: (payload: unknown) => T | null;
  describe: Describe<T>;
}) {
  // The shared list is capped across every workflow type, so approved artifacts
  // are also paged per type from the server; both sources merge, newest first.
  const listed = useMemo(() => engine?.workflows.filter((item) => item.workflow_type === workflowType && item.status === "COMPLETED") ?? [], [engine, workflowType]);
  const listedSignature = listed.map((item) => item.id).join("|");
  const [history, setHistory] = useState<{ workflows: WorkflowList["workflows"]; runs: WorkflowList["runs"]; nextCursor: ApprovedWorkflowPage["nextCursor"]; paged: boolean; error: string | null }>({ workflows: [], runs: [], nextCursor: null, paged: false, error: null });
  const [loadingOlder, setLoadingOlder] = useState(false);

  // The newest page is re-read when a new approval appears in the shared list.
  // Pages are only ever added, so an older artifact the operator chose never
  // disappears from the picker (which would silently re-select the newest).
  useEffect(() => {
    let disposed = false;
    fetchApprovedWorkflowPage(workflowType, null, `Could not load older approved ${label}s.`)
      .then((page) => {
        if (disposed) return;
        setHistory((current) => ({
          workflows: mergeById(current.workflows, page.workflows),
          runs: mergeById(current.runs, page.runs),
          nextCursor: current.paged ? current.nextCursor : page.nextCursor,
          paged: true,
          error: null,
        }));
      })
      .catch((cause: unknown) => { if (!disposed) setHistory((current) => ({ ...current, error: cause instanceof Error ? cause.message : `Could not load older approved ${label}s.` })); });
    return () => { disposed = true; };
  }, [workflowType, label, listedSignature]);

  const loadOlder = async () => {
    if (!history.nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await fetchApprovedWorkflowPage(workflowType, history.nextCursor, `Could not load older approved ${label}s.`);
      setHistory((current) => ({ workflows: mergeById(current.workflows, page.workflows), runs: mergeById(current.runs, page.runs), nextCursor: page.nextCursor, paged: true, error: null }));
    } catch (cause) {
      setHistory((current) => ({ ...current, error: cause instanceof Error ? cause.message : `Could not load older approved ${label}s.` }));
    } finally {
      setLoadingOlder(false);
    }
  };

  const eligible = useMemo(() => mergeById(listed, history.workflows)
    .filter((item) => item.workflow_type === workflowType && item.status === "COMPLETED")
    .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id)), [listed, history.workflows, workflowType]);
  const [chosenId, setChosenId] = useState<string>();
  const selectedId = chosenId && eligible.some((item) => item.id === chosenId) ? chosenId : eligible[0]?.id;
  const [resolved, setResolved] = useState<{ id: string; upstream: ApprovedUpstream<T> | null; error: string | null } | null>(null);
  // A failed resolution is retried when the workspace next refreshes its list;
  // a successful one is immutable (approved artifacts never change) and is kept.
  const retryToken = resolved && resolved.id === selectedId && resolved.error ? engine : undefined;

  useEffect(() => {
    if (!selectedId) return;
    let disposed = false;
    fetchWorkflowDetail<WorkflowDetailBase>(selectedId, `Could not load the approved ${label}.`)
      .then((detail) => {
        if (disposed) return;
        const run = currentRunOf(detail);
        const output = run && run.status === "COMPLETED" ? parse(run.output_payload) : null;
        if (!run || output === null) {
          setResolved({ id: selectedId, upstream: null, error: `The approved ${label} has no readable completed output, so nothing can be started from it.` });
          return;
        }
        setResolved({
          id: selectedId,
          error: null,
          upstream: { workflowId: selectedId, runId: run.id, version: runVersionOf(detail, run.id), approvedAt: run.completed_at, output, ...describe(output) },
        });
      })
      .catch((cause: unknown) => {
        if (!disposed) setResolved({ id: selectedId, upstream: null, error: cause instanceof Error ? cause.message : `Could not load the approved ${label}.` });
      });
    return () => { disposed = true; };
    // parse/describe are pure helpers supplied inline; the selection identity (and a retry after failure) drives resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, label, retryToken]);

  const current = resolved?.id === selectedId ? resolved : null;
  /** Picker labels come from the list payload when it carries the run output. */
  const runOf = (workflow: WorkflowList["workflows"][number]) => engine?.runs?.find((run) => run.id === workflow.current_run_id) ?? history.runs.find((run) => run.id === workflow.current_run_id);
  const optionLabel = (workflow: WorkflowList["workflows"][number]) => {
    const payload = runOf(workflow)?.output_payload;
    const output = payload === undefined ? null : parse(payload);
    const approved = workflow.completed_at ?? runOf(workflow)?.completed_at;
    const when = approved ? `approved ${formatDay(approved)}` : `created ${formatDay(workflow.created_at)}`;
    return output ? `${describe(output).title} · ${when}` : `Approved ${label} · ${when}`;
  };

  return {
    eligible,
    selectedId,
    choose: setChosenId,
    upstream: current?.upstream ?? null,
    loading: Boolean(selectedId) && !current,
    error: current?.error ?? null,
    optionLabel,
    hasOlder: history.nextCursor !== null,
    loadingOlder,
    loadOlder,
    historyError: history.error,
  };
}

const mergeById = <T extends { id: string }>(first: T[], second: T[]) => {
  const seen = new Set(first.map((item) => item.id));
  return [...first, ...second.filter((item) => !seen.has(item.id))];
};

/**
 * Card identity only needs an object payload; authority stays with the server,
 * which re-resolves and re-verifies the exact approved artifact on start.
 */
export const parseObjectPayload = (payload: unknown): Record<string, unknown> | null =>
  payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;

/** Reads a non-empty string at a path inside an untyped payload. */
export const textAt = (value: unknown, path: string[]) => {
  let cursor = value;
  for (const key of path) cursor = cursor && typeof cursor === "object" ? (cursor as Record<string, unknown>)[key] : undefined;
  return typeof cursor === "string" && cursor.trim() ? cursor : undefined;
};

/** Video-stage artifacts all carry source.workingConcept; a release also carries its final title. */
export const describeVideoArtifact = (fallback: string) => (output: Record<string, unknown>) => {
  const concept = textAt(output, ["source", "workingConcept"]);
  const finalTitle = textAt(output, ["reconciledMetadata", "finalTitle"]);
  return { title: finalTitle ?? concept ?? fallback, detail: finalTitle && concept && finalTitle !== concept ? concept : undefined };
};

const formatDay = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Shows, in plain language, the exact approved artifact the next action consumes. */
export function UpstreamCard<T>({ heading, kindLabel, selection, disabled }: {
  /** e.g. "Create packaging from". */
  heading: string;
  /** Capitalized noun, e.g. "Script". */
  kindLabel: string;
  selection: ReturnType<typeof useApprovedUpstream<T>>;
  disabled?: boolean;
}) {
  const { eligible, selectedId, upstream, loading, error } = selection;
  if (!selectedId) return null;
  const noun = kindLabel.toLowerCase();
  // The picker stays available while a choice loads or fails, so the operator can change course.
  const picker = <>
    {eligible.length > 1 && (
      <label>
        Use a different approved {noun}
        <select value={selectedId} onChange={(event) => selection.choose(event.target.value)} disabled={disabled}>
          {eligible.map((item, index) => <option key={item.id} value={item.id}>{selection.optionLabel(item)}{index === 0 ? " (newest)" : ""}</option>)}
        </select>
      </label>
    )}
    {selection.hasOlder && <button type="button" className="button button-quiet" onClick={() => void selection.loadOlder()} disabled={disabled || selection.loadingOlder}>{selection.loadingOlder ? `Loading older approved ${noun}s…` : `Load older approved ${noun}s`}</button>}
    {selection.historyError && <p className="muted">{selection.historyError} Only recently approved {noun}s are listed.</p>}
  </>;
  if (loading) return <><p className="upstream-empty" role="status">Loading the approved {kindLabel.toLowerCase()}…</p>{picker}</>;
  if (error || !upstream) return <><div className="error-banner" role="alert">{error ?? `The approved ${kindLabel.toLowerCase()} could not be resolved.`}</div>{picker}</>;
  return (
    <section className="upstream-card" aria-label={`Selected approved ${kindLabel.toLowerCase()}`}>
      <p className="eyebrow">{heading}</p>
      <h3>{upstream.title}</h3>
      <p className="upstream-meta">
        <span>{kindLabel}{upstream.version ? ` v${upstream.version}` : ""} · approved{upstream.approvedAt ? ` ${formatDay(upstream.approvedAt)}` : ""}</span>
        {upstream.detail && <span>{upstream.detail}</span>}
        {eligible.length > 1 && <span>{eligible.length}{selection.hasOlder ? "+" : ""} approved {noun}s available</span>}
      </p>
      {picker}
      <details>
        <summary>Technical provenance</summary>
        <dl>
          <dt>Workflow ID</dt><dd><code>{upstream.workflowId}</code></dd>
          <dt>Approved run ID</dt><dd><code>{upstream.runId}</code></dd>
        </dl>
      </details>
    </section>
  );
}
