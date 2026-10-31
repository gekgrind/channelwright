import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadLive, requireLiveUser } from "@/server/lineage/live-command-center";
import { LiveCommandCenter, LiveUnavailable } from "../live-command-center";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Command Center" };

const CHANNEL_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One channel's live Command Center. The key is a research workflow id; a key
 * that is malformed, or not one of this user's channels, is a 404, so another
 * account's channel is indistinguishable from one that does not exist.
 */
export default async function LiveChannelPage({ params }: { params: Promise<{ channelKey: string }> }) {
  const user = await requireLiveUser();
  const channelKey = (await params).channelKey.toLowerCase();
  if (!CHANNEL_KEY.test(channelKey)) notFound();
  const live = await loadLive(user.id);
  if (live.status !== "ok") return <LiveUnavailable state={live} />;
  if (!live.graph.channels.some((channel) => channel.key === channelKey)) notFound();
  return <LiveCommandCenter userId={user.id} live={live} channelKey={channelKey} />;
}
