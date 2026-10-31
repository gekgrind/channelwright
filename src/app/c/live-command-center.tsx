import { AppShell } from "@/features/command-center/app-shell";
import { CommandCenter, formatDate } from "@/features/command-center/command-center";
import { stageOutputRequest, toCommandCenterView } from "@/server/lineage/command-center-view";
import type { LiveLoad } from "@/server/lineage/live-command-center";
import { loadStageOutputs } from "@/server/lineage/load-stage-outputs";

/** The live Command Center for one channel, or the no-channel landing when `channelKey` is null. */
export async function LiveCommandCenter({ userId, live, channelKey }: { userId: string; live: Extract<LiveLoad, { status: "ok" }>; channelKey: string | null }) {
  const { strategy, content, performance } = await loadStageOutputs(userId, stageOutputRequest(live.rows, live.graph, channelKey));
  // Content plans title every video and gate and choose the next brief, so without them the page is not shown.
  if (content.status === "error") return <LiveUnavailable state={content} />;
  const outputs = { strategy, content: content.data, performance };
  const view = toCommandCenterView({ rows: live.rows, graph: live.graph, approvalsError: live.approvalsError, outputs }, channelKey, new Date().toISOString());
  const channels = live.graph.channels.map((channel) => ({
    label: channel.label,
    detail: `Researched ${formatDate(channel.createdAt)}`,
    href: `/c/${channel.key}`,
    current: channel.key === channelKey,
  }));
  return (
    <AppShell
      channelLabel={channels.find((channel) => channel.current)?.label ?? "No channel yet"}
      channelDetail=""
      pendingCount={view.globalPendingCount}
      commandCenterHref={channelKey ? `/c/${channelKey}` : "/c"}
      channels={channels}
    >
      <CommandCenter view={view} />
    </AppShell>
  );
}

/** The whole page cannot be grouped: workflows or runs failed to load, or there are too many. */
export function LiveUnavailable({ state }: { state: Exclude<LiveLoad, { status: "ok" }> }) {
  return (
    <AppShell channelLabel="Command Center" channelDetail="" pendingCount={null} commandCenterHref="/c" channels={[]}>
      <section className="cw-panel" aria-labelledby="cw-live-unavailable-h">
        <h1 id="cw-live-unavailable-h">Command Center</h1>
        <div className="cw-state cw-state-error" role="alert">
          {state.status === "too_large"
            ? <p>This account has more work than the Command Center can group yet. Nothing was changed. Your work stays available in the current Studio.</p>
            : <p>Your work did not load, so the Command Center cannot be shown. Nothing was changed.</p>}
          {state.status === "error" && <p className="cw-mono cw-case">Request ID {state.requestId}</p>}
        </div>
      </section>
    </AppShell>
  );
}
