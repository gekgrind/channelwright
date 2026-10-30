import type { ReactNode } from "react";
import {
  STAGE_LABEL, VIDEO_STAGES,
  type Attribution, type ChannelIdentity, type CommandCenterView, type LearningItem, type PendingGate, type PerformanceRow, type SectionState, type VideoInFlight,
} from "./model";
import { CURRENT_STUDIO_ANCHOR, gateItemId, parseInstant, rankNextDecision, TIER_LABEL } from "./next-decision";

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const NUMBER = new Intl.NumberFormat("en-US");
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Short UTC date, or a dash when the timestamp is not valid. */
export function formatDate(iso: string) {
  const instant = parseInstant(iso);
  return instant === null ? "—" : DATE.format(instant);
}

/** Compact age relative to the view's evaluation time, so output is deterministic. */
export function age(fromIso: string, asOfIso: string) {
  const from = parseInstant(fromIso);
  const asOf = parseInstant(asOfIso);
  if (from === null || asOf === null) return "—";
  const minutes = Math.max(0, Math.floor((asOf - from) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1_440)}d`;
}

/**
 * Where Command Center actions lead. Data always carries live-shaped hrefs;
 * a surface that cannot honour them (the fixture preview) swaps in its own
 * destinations, and null marks an action as not available there.
 */
export interface ActionTargets {
  /** A ranked item or gate review link, by candidate id. */
  item(id: string, liveHref: string): string | null;
  /** A section's empty-state action. */
  action(liveHref: string): string | null;
  /** Words on a gate's review link. */
  reviewLabel: string;
}

export const LIVE_TARGETS: ActionTargets = { item: (_id, href) => href, action: (href) => href, reviewLabel: "Review in current Studio" };

/** A link when the action has a destination here; otherwise the same words, marked unavailable. */
function Action({ href, label, className }: { href: string | null; label: string; className: string }) {
  if (href === null) return <p className="cw-mono cw-warn">{label} · Not available here</p>;
  return <a className={className} href={href}>{label} <span aria-hidden="true">→</span></a>;
}

export function CommandCenter({ view, targets = LIVE_TARGETS }: { view: CommandCenterView; targets?: ActionTargets }) {
  const ambiguous = <T extends { attribution: Attribution }>(state: SectionState<T[]>) =>
    state.status === "ready" ? state.data.filter((item): item is T & { attribution: { status: "ambiguous"; reason: string } } => item.attribution.status === "ambiguous") : [];
  const unattributedVideos = ambiguous(view.videos);
  const unattributedGates = ambiguous(view.gates);
  // Every unattributed item is named with its reason, including videos that have no pending gate.
  const unattributedItems = [
    ...unattributedVideos.map((video) => ({ id: `video:${video.rootWorkflowId}`, kind: "Video", title: video.title, reason: video.attribution.reason })),
    ...unattributedGates.map((gate) => ({ id: `gate:${gate.approvalId}`, kind: "Gate", title: `${STAGE_LABEL[gate.stage]} v${gate.version} · ${gate.subject}`, reason: gate.attribution.reason })),
  ];
  return (
    <div className="cw-cc">
      <IdentityHeader state={view.channel} targets={targets} />
      <div className="cw-row">
        <NextDecisionPanel view={view} targets={targets} />
        <Section index="02" id="cw-gates" title="Needs your decision" className="cw-span5" state={attributedOnly(view.gates)} targets={targets}
          render={(gates) => <GateList gates={gates} asOf={view.asOf} targets={targets} />} />
      </div>
      {unattributedItems.length > 0 && (
        <div className="cw-notice" role="note">
          <p>
            <span className="cw-mono cw-warn">Unattributed · {plural(unattributedVideos.length, "video")}, {plural(unattributedGates.length, "gate")}</span>
            {" "}Some work could not be traced to this channel through approved lineage, so it is not shown or ranked here. Nothing was guessed. Its gates stay decidable in the current Studio.
          </p>
          <details className="cw-why">
            <summary>Show unattributed work · {unattributedItems.length}</summary>
            <ul className="cw-why-list" aria-label="Unattributed work">
              {unattributedItems.map((item) => <li key={item.id}><span className="cw-mono">{item.kind}</span><span>{item.title}<small>Not attributed: {item.reason}</small></span><span /></li>)}
            </ul>
          </details>
        </div>
      )}
      <Section index="03" id="cw-videos" title="Videos in flight" state={attributedOnly(view.videos)} targets={targets}
        render={(videos) => <VideoTable videos={videos} asOf={view.asOf} />} />
      <div className="cw-row">
        <Section index="04" id="cw-learning" title="What we're learning" className="cw-span7" state={view.learning} targets={targets}
          render={(items) => <LearningList items={items} />} />
        <Section index="05" id="cw-performance" title="Recent performance" className="cw-span5" state={view.performance} targets={targets}
          caption="Entered by you · YouTube not connected"
          render={(rows) => <PerformanceTable rows={rows} />} />
      </div>
    </div>
  );
}

function attributedOnly<T extends { attribution: { status: string } }>(state: SectionState<T[]>): SectionState<T[]> {
  return state.status === "ready" ? { status: "ready", data: state.data.filter((item) => item.attribution.status === "resolved") } : state;
}

function IdentityHeader({ state, targets }: { state: SectionState<ChannelIdentity>; targets: ActionTargets }) {
  if (state.status !== "ready") {
    return (
      <header className="cw-ident">
        <div className="cw-ident-copy">
          <span className="cw-mono">Command Center</span>
          <h1>{state.status === "empty" ? "Earn the right to make a video first." : "Channel"}</h1>
          <SectionBody state={state} render={() => null} targets={targets} />
        </div>
      </header>
    );
  }
  const channel = state.data;
  return (
    <header className="cw-ident">
      <div className="cw-ident-copy">
        <span className="cw-mono">Command Center</span>
        <h1>{channel.label}</h1>
        {channel.thesis && <p className="cw-lume2">{channel.thesis}</p>}
      </div>
      <dl className="cw-meta" aria-label="Channel strategy summary">
        <div><dt className="cw-mono">Strategy</dt><dd>{channel.strategyVersion ? `v${channel.strategyVersion} · ${formatDate(channel.strategyApprovedAt!)}` : "None approved"}</dd></div>
        <div><dt className="cw-mono">Revenue paths</dt><dd>{channel.revenuePathCount ?? "—"}</dd></div>
        <div><dt className="cw-mono">Last review</dt><dd>{channel.lastReview ? reviewLabel(channel.lastReview.outcome) : "None yet"}</dd></div>
      </dl>
    </header>
  );
}

const reviewLabel = (outcome: NonNullable<ChannelIdentity["lastReview"]>["outcome"]) =>
  outcome === "HOLD" ? "Hold" : outcome === "REVISE" ? "Revise" : "Insufficient evidence";

function NextDecisionPanel({ view, targets }: { view: CommandCenterView; targets: ActionTargets }) {
  const decision = rankNextDecision(view);
  const { primary } = decision;
  const waiting = decision.deferred.length + decision.excluded.length;
  return (
    <section className="cw-nba cw-span7" aria-labelledby="cw-nba-h">
      <div className="cw-sh">
        <span className="cw-mono cw-signal"><span className="cw-dot" aria-hidden="true" />01 · Next decision</span>
        {primary && <span className="cw-tag">{TIER_LABEL[primary.tier]} · {primary.rule}</span>}
      </div>
      <h2 id="cw-nba-h">{primary ? primary.title : "Nothing needs you right now."}</h2>
      {primary && <p className="cw-lume2 cw-measure">{primary.detail}</p>}
      {!decision.complete && <p className="cw-warn-text">Approvals did not load, so a pending decision may be missing from this ranking.</p>}
      {primary && <Action className="cw-btn cw-btn-signal" href={targets.item(primary.id, primary.href)} label={primary.cta} />}
      {waiting > 0 && (
        <details className="cw-why">
          <summary>Why this, not something else? · {waiting} more</summary>
          {decision.deferred.length > 0 && (
            <ol className="cw-why-list" aria-label="Also waiting, in rank order">
              {decision.deferred.map((item) => {
                const href = targets.item(item.id, item.href);
                return <li key={item.id}><span className="cw-mono">{TIER_LABEL[item.tier].split(" ")[0]}</span><span>{item.title}</span>{href === null ? <span className="cw-mono cw-warn">Not available here</span> : <a className="cw-mono" href={href}>Open</a>}</li>;
              })}
            </ol>
          )}
          {decision.excluded.length > 0 && (
            <ul className="cw-why-list" aria-label="Not ranked">
              {decision.excluded.map((item) => <li key={item.id}><span className="cw-mono">Not ranked</span><span>{item.title}<small>{item.reason}</small></span><span /></li>)}
            </ul>
          )}
        </details>
      )}
      <p className="cw-mono cw-quiet">Advice, not automation. Nothing starts until you do.</p>
    </section>
  );
}

function Section<T>({ index, id, title, state, render, targets, className, caption }: {
  index: string; id: string; title: string; state: SectionState<T>; render: (data: T) => ReactNode; targets: ActionTargets; className?: string; caption?: string;
}) {
  return (
    <section className={`cw-panel ${className ?? ""}`.trim()} aria-labelledby={`${id}-h`} aria-busy={state.status === "loading" || undefined}>
      <div className="cw-sh"><h2 id={`${id}-h`}><span className="cw-mono">{index}</span>{title}</h2></div>
      {caption && state.status === "ready" && <p className="cw-mono cw-quiet">{caption}</p>}
      <SectionBody state={state} render={render} targets={targets} />
    </section>
  );
}

function SectionBody<T>({ state, render, targets }: { state: SectionState<T>; render: (data: T) => ReactNode; targets: ActionTargets }) {
  switch (state.status) {
    case "ready": return <>{render(state.data)}</>;
    case "loading": return <div className="cw-skeleton" aria-label="Loading"><i /><i /><i /><i /></div>;
    case "empty": return <div className="cw-state"><p>{state.message}</p>{state.action && <Action className="cw-btn" href={targets.action(state.action.href)} label={state.action.label} />}</div>;
    case "unavailable": return <div className="cw-state"><p>{state.message}</p><p className="cw-mono">Not available yet · {state.dependency}</p></div>;
    case "error": return (
      <div className="cw-state cw-state-error" role="alert">
        <p>{state.message} The rest of this page is current.</p>
        <a className="cw-btn" href="">Retry</a>
        <p className="cw-mono cw-case">Request ID {state.requestId}</p>
      </div>
    );
  }
}

function GateList({ gates, asOf, targets }: { gates: PendingGate[]; asOf: string; targets: ActionTargets }) {
  if (gates.length === 0) return <div className="cw-state"><p>Nothing is waiting on you. Gates appear here the moment a workflow pauses for review.</p></div>;
  return (
    <>
      <ul className="cw-gates">
        {gates.map((gate) => (
          <li key={gate.approvalId}>
            <div className="cw-gate-tags">
              <span className="cw-tag cw-tag-signal">{STAGE_LABEL[gate.stage]} · v{gate.version}</span>
              {gate.supersedesVersion && <span className="cw-tag">Supersedes v{gate.supersedesVersion}</span>}
            </div>
            <p className="cw-gate-title">{gate.subject}</p>
            <p className="cw-mono cw-quiet">{gate.note} · {age(gate.requestedAt, asOf)}</p>
            {gate.surface === "available" && CURRENT_STUDIO_ANCHOR[gate.stage]
              ? <Action className="cw-mono cw-go" href={targets.item(gateItemId(gate), CURRENT_STUDIO_ANCHOR[gate.stage]!)} label={targets.reviewLabel} />
              : <p className="cw-mono cw-warn">No review screen yet</p>}
          </li>
        ))}
      </ul>
      <p className="cw-mono cw-quiet cw-rule">Decisions open the full artifact. Nothing is approved from here.</p>
    </>
  );
}

const CELL_TEXT = { done: "done", you: "your move", system: "running", recover: "needs recovery", none: "not started" } as const;

function trackLabel(video: VideoInFlight) {
  const current = VIDEO_STAGES.find((stage) => stage.key === video.currentStage)!;
  const done = VIDEO_STAGES.filter((stage) => video.cells[stage.key] === "done").length;
  return `${done} of 8 stages done. ${current.label}: ${CELL_TEXT[video.cells[video.currentStage]]}.`;
}

function VideoTable({ videos, asOf }: { videos: VideoInFlight[]; asOf: string }) {
  if (videos.length === 0) return <div className="cw-state"><p>No attributed videos in flight.</p></div>;
  return (
    <div className="cw-table-box">
      <table className="cw-table">
        <thead><tr><th scope="col">Video</th><th scope="col">Make 01–04 · Learn 05–08</th><th scope="col">Stage</th><th scope="col">Waiting on</th><th scope="col" className="cw-num">Age</th></tr></thead>
        <tbody>
          {videos.map((video) => (
            <tr key={video.rootWorkflowId}>
              <td className="cw-video-title">{video.title}</td>
              <td>
                <div className="cw-track" role="img" aria-label={trackLabel(video)}>
                  {VIDEO_STAGES.map((stage, index) => (
                    <i key={stage.key} className={`cw-cell cw-cell-${video.cells[stage.key]}${index === 4 ? " cw-cell-learn" : ""}`} />
                  ))}
                </div>
              </td>
              <td>{video.stateLabel}</td>
              <td><span className={video.waitingOn === "you" ? "cw-mono cw-signal" : "cw-mono"}>{video.waitingLabel}</span></td>
              <td className="cw-num">{age(video.updatedAt, asOf)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const OUTCOME: Record<LearningItem["outcome"], { label: string; tone: string }> = {
  SUPPORTED: { label: "Supported", tone: "cw-tag-pass" },
  NOT_SUPPORTED: { label: "Not supported", tone: "cw-tag-warn" },
  INCONCLUSIVE: { label: "Inconclusive", tone: "" },
  RUNNING: { label: "Running", tone: "" },
  ADOPTED: { label: "Adopted", tone: "cw-tag-pass" },
  HELD: { label: "Held provisionally", tone: "" },
  HOLD: { label: "Hold", tone: "" },
};

function LearningList({ items }: { items: LearningItem[] }) {
  return (
    <ul className="cw-learn">
      {items.map((item) => (
        <li key={item.id}>
          <span className={`cw-tag ${OUTCOME[item.outcome].tone}`.trim()}>{OUTCOME[item.outcome].label}</span>
          <div><p className="cw-learn-title">{item.statement}</p><p className="cw-mono cw-quiet">{item.source}</p></div>
        </li>
      ))}
    </ul>
  );
}

const VERSUS: Record<PerformanceRow["versusPlan"], { label: string; tone: string }> = {
  ABOVE: { label: "Above", tone: "cw-pass" },
  ON_PLAN: { label: "On plan", tone: "cw-lume2" },
  BELOW: { label: "Below", tone: "cw-warn" },
  NOT_ENTERED: { label: "Not entered", tone: "cw-quiet" },
  NOT_ASSESSED: { label: "Not assessed", tone: "cw-quiet" },
};

function PerformanceTable({ rows }: { rows: PerformanceRow[] }) {
  return (
    <>
      <div className="cw-table-box">
        <table className="cw-table cw-table-compact">
          <thead><tr><th scope="col">Video</th><th scope="col" className="cw-num">Views</th><th scope="col" className="cw-num">Avg viewed</th><th scope="col" className="cw-num">vs plan</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.videoTitle}>
                <td>{row.videoTitle}</td>
                <td className="cw-num">{row.views === null ? "—" : NUMBER.format(row.views)}</td>
                <td className="cw-num">{row.averageViewedPct === null ? "—" : `${row.averageViewedPct}%`}</td>
                <td className={`cw-num cw-mono ${VERSUS[row.versusPlan].tone}`}>{VERSUS[row.versusPlan].label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cw-mono cw-quiet">Trend charts are not built yet.</p>
    </>
  );
}
