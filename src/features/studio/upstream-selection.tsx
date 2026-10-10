"use client";

import { useEffect, useMemo, useState } from "react";
import { currentRunOf, fetchWorkflowDetail, runVersionOf, type WorkflowDetailBase, type WorkflowList } from "./workflow-api";

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
  const eligible = useMemo(() => engine?.workflows.filter((item) => item.workflow_type === workflowType && item.status === "COMPLETED") ?? [], [engine, workflowType]);
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
  const optionLabel = (workflow: WorkflowList["workflows"][number]) => {
    const payload = engine?.runs?.find((run) => run.id === workflow.current_run_id)?.output_payload;
    const output = payload === undefined ? null : parse(payload);
    const approved = workflow.completed_at ?? engine?.runs?.find((run) => run.id === workflow.current_run_id)?.completed_at;
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
  };
}

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
  if (loading) return <p className="upstream-empty" role="status">Loading the approved {kindLabel.toLowerCase()}…</p>;
  if (error || !upstream) return <div className="error-banner" role="alert">{error ?? `The approved ${kindLabel.toLowerCase()} could not be resolved.`}</div>;
  return (
    <section className="upstream-card" aria-label={`Selected approved ${kindLabel.toLowerCase()}`}>
      <p className="eyebrow">{heading}</p>
      <h3>{upstream.title}</h3>
      <p className="upstream-meta">
        <span>{kindLabel}{upstream.version ? ` v${upstream.version}` : ""} · approved{upstream.approvedAt ? ` ${formatDay(upstream.approvedAt)}` : ""}</span>
        {upstream.detail && <span>{upstream.detail}</span>}
        {eligible.length > 1 && <span>{eligible.length} approved {kindLabel.toLowerCase()}s available</span>}
      </p>
      {eligible.length > 1 && (
        <label>
          Use a different approved {kindLabel.toLowerCase()}
          <select value={selectedId} onChange={(event) => selection.choose(event.target.value)} disabled={disabled}>
            {eligible.map((item, index) => <option key={item.id} value={item.id}>{selection.optionLabel(item)}{index === 0 ? " (newest)" : ""}</option>)}
          </select>
        </label>
      )}
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
