import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { isMockMode } from "@/server/config";
import { AppShell } from "@/features/command-center/app-shell";
import { CommandCenter } from "@/features/command-center/command-center";
import { FixtureRecord, fixtureTargets } from "@/features/command-center/fixture-record";
import { SCENARIOS, isScenarioKey, scenarioFor } from "@/features/command-center/fixtures";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Command Center preview" };

const SCENARIO_LABEL: Record<keyof typeof SCENARIOS, string> = { operating: "Operating", "first-run": "First run", degraded: "Degraded" };

/**
 * Phase B fixture preview. Fixture data never reaches a production deployment:
 * outside fixture mode this route does not exist. It reads no workflow data.
 * `?item=` opens the preview's own record of a synthetic item, because the
 * current Studio holds no fixture artifacts.
 */
export default async function CommandCenterPreviewPage({ searchParams }: { searchParams: Promise<{ scenario?: string; item?: string | string[] }> }) {
  if (!isMockMode()) notFound();
  await requireUser();
  const { scenario: requested, item } = await searchParams;
  const active = isScenarioKey(requested) ? requested : "operating";
  const view = scenarioFor(active);
  const channel = view.channel.status === "ready" ? view.channel.data : null;
  return (
    <AppShell
      channelLabel={channel?.label ?? "No channel yet"}
      channelDetail={channel?.strategyVersion ? `Strategy v${channel.strategyVersion}` : "No strategy"}
      pendingCount={view.globalPendingCount}
      banner={
        <div className="cw-banner">
          <p className="cw-mono">Fixture preview · demonstration data, not your workflows</p>
          <ul aria-label="Preview scenario">
            {(Object.keys(SCENARIOS) as Array<keyof typeof SCENARIOS>).map((key) => (
              <li key={key}><Link href={`/studio/preview?scenario=${key}`} aria-current={key === active ? "page" : undefined}>{SCENARIO_LABEL[key]}</Link></li>
            ))}
          </ul>
        </div>
      }
    >
      {typeof item === "string"
        ? <FixtureRecord view={view} scenarioLabel={SCENARIO_LABEL[active]} itemId={item} />
        : <CommandCenter view={view} targets={fixtureTargets(active)} />}
    </AppShell>
  );
}
