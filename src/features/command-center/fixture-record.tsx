import Link from "next/link";
import { age, formatDate, type ActionTargets } from "./command-center";
import { STAGE_LABEL, type CommandCenterView, type OperatorTask, type PendingGate } from "./model";
import { gateItemId, rankNextDecision, TIER_LABEL, type Candidate } from "./next-decision";

/**
 * Fixture-safe destinations for the Phase B preview. The current Studio has no
 * stage anchors for a mock user and never holds fixture artifacts, so preview
 * actions open the preview's own record of the synthetic item instead.
 */

export const previewHref = (scenario: string, itemId?: string) =>
  `/studio/preview?scenario=${encodeURIComponent(scenario)}${itemId ? `&item=${encodeURIComponent(itemId)}` : ""}`;

export const fixtureTargets = (scenario: string): ActionTargets => ({
  item: (id) => previewHref(scenario, id),
  // Section actions start new work, and the fixtures hold no record of it.
  action: () => null,
  reviewLabel: "Open fixture record",
});

export type FixtureItem = { candidate: Candidate } & ({ kind: "gate"; gate: PendingGate } | { kind: "task"; task: OperatorTask });

/** Resolves only what the preview links to: this scenario's ranked candidates. */
export function findFixtureItem(view: CommandCenterView, id: string): FixtureItem | null {
  const { primary, deferred } = rankNextDecision(view);
  const candidate = [primary, ...deferred].find((item) => item?.id === id);
  if (!candidate) return null;
  const gate = view.gates.status === "ready" ? view.gates.data.find((item) => gateItemId(item) === id) : undefined;
  if (gate) return { candidate, kind: "gate", gate };
  const task = view.tasks.find((item) => `task:${item.id}` === id);
  return task ? { candidate, kind: "task", task } : null;
}

export function FixtureRecord({ view, scenarioLabel, itemId }: { view: CommandCenterView; scenarioLabel: string; itemId: string }) {
  const found = findFixtureItem(view, itemId);
  return (
    <article className="cw-record" aria-labelledby="cw-record-h">
      <Link className="cw-mono cw-go" href={previewHref(view.scenario)}><span aria-hidden="true">←</span>&nbsp;Back to Command Center</Link>
      {found ? <RecordBody item={found} asOf={view.asOf} /> : (
        <>
          <span className="cw-mono">Fixture record</span>
          <h1 id="cw-record-h">That item is not in the {scenarioLabel} scenario.</h1>
          <p className="cw-lume2">Only work the Command Center ranks in this scenario has a fixture record.</p>
        </>
      )}
    </article>
  );
}

function RecordBody({ item, asOf }: { item: FixtureItem; asOf: string }) {
  const { candidate } = item;
  return (
    <>
      <div className="cw-sh">
        <span className="cw-mono">Fixture record · demonstration data</span>
        <span className="cw-tag">{TIER_LABEL[candidate.tier]} · {candidate.rule}</span>
      </div>
      <h1 id="cw-record-h">{candidate.title}</h1>
      {item.kind === "gate" && (
        <div className="cw-gate-tags">
          <span className="cw-tag cw-tag-signal">{STAGE_LABEL[item.gate.stage]} · v{item.gate.version}</span>
          {item.gate.supersedesVersion && <span className="cw-tag">Supersedes v{item.gate.supersedesVersion}</span>}
        </div>
      )}
      <p className="cw-lume2 cw-measure">{candidate.detail}</p>
      {item.kind === "gate" ? (
        <dl className="cw-meta" aria-label="Record details">
          <div><dt className="cw-mono">Stage</dt><dd>{STAGE_LABEL[item.gate.stage]}</dd></div>
          <div><dt className="cw-mono">Version</dt><dd>v{item.gate.version}</dd></div>
          <div><dt className="cw-mono">Waiting</dt><dd>{age(item.gate.requestedAt, asOf)}</dd></div>
          <div><dt className="cw-mono">Workflow</dt><dd>{item.gate.workflowId}</dd></div>
          <div><dt className="cw-mono">Run</dt><dd>{item.gate.runId}</dd></div>
        </dl>
      ) : (
        <dl className="cw-meta" aria-label="Record details">
          <div><dt className="cw-mono">Stage</dt><dd>{STAGE_LABEL[item.task.stage]}</dd></div>
          <div><dt className="cw-mono">Open for</dt><dd>{age(item.task.createdAt, asOf)}</dd></div>
          <div><dt className="cw-mono">Due</dt><dd>{item.task.dueAt ? formatDate(item.task.dueAt) : "No due rule"}</dd></div>
        </dl>
      )}
      <p className="cw-state">
        {item.kind === "gate"
          ? "The artifact itself, and its Approve and Request revision controls, are not part of the fixture. A live build opens the full artifact in its review screen. Nothing is approved from here."
          : "Starting this work is not part of the fixture. A live build opens its screen in the Studio. Nothing is started from here."}
      </p>
    </>
  );
}
