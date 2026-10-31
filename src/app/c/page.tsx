import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { mostRecentChannelKey } from "@/server/lineage/command-center-view";
import { loadLive, requireLiveUser } from "@/server/lineage/live-command-center";
import { LiveCommandCenter, LiveUnavailable } from "./live-command-center";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Command Center" };

/**
 * Live Command Center entry. Off unless the rollout gate admits this user
 * (see requireLiveUser). Opens the most recently active channel, or the
 * no-channel landing, which still lists unattributed work.
 */
export default async function LiveCommandCenterIndex() {
  const user = await requireLiveUser();
  const live = await loadLive(user.id);
  if (live.status !== "ok") return <LiveUnavailable state={live} />;
  const key = mostRecentChannelKey(live.rows, live.graph);
  if (key) redirect(`/c/${key}`);
  return <LiveCommandCenter userId={user.id} live={live} channelKey={null} />;
}
