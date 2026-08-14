import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  channelPreferencesSchema, distributionTargetsSchema, platformPackageSchema, youtubeOnlyDistributionTargets,
} from "./contracts";
import { platformConstraints } from "./platform-constraints";
import type { WorkspaceSnapshot } from "./entities";
import { normalizeWorkspace } from "@/server/repository";

const basePreferences = { name: "Test channel", niche: "Business" };

describe("distribution preferences", () => {
  it("defaults missing preferences to YouTube only", () => {
    expect(channelPreferencesSchema.parse(basePreferences).distributionTargets).toEqual(youtubeOnlyDistributionTargets);
  });

  it.each([
    ["YouTube only", false, false],
    ["TikTok only", true, false],
    ["Reels only", false, true],
    ["both vertical targets", true, true],
  ])("parses %s", (_label, tiktok, instagramFacebookReels) => {
    expect(distributionTargetsSchema.parse({ youtube: true, tiktok, instagramFacebookReels })).toEqual({ youtube: true, tiktok, instagramFacebookReels });
  });

  it("does not allow YouTube to be disabled", () => {
    expect(distributionTargetsSchema.safeParse({ youtube: false, tiktok: true, instagramFacebookReels: false }).success).toBe(false);
  });

  it("loads pre-feature fixture channels and videos as YouTube-only", () => {
    const oldWorkspace = {
      channels: [{ id: crypto.randomUUID(), ownerId: "owner", state: "READY_FOR_VIDEO_PRODUCTION", mode: "USER_DEFINED", preferences: basePreferences, concepts: [], decisions: [], candidates: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      videos: [{ id: crypto.randomUUID(), ownerId: "owner", channelId: "channel", topic: "Legacy video", state: "SCRIPT_APPROVED", scripts: [], approvals: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      agentRuns: [], auditEvents: [], idempotency: {},
    } as unknown as WorkspaceSnapshot;
    const normalized = normalizeWorkspace(oldWorkspace);
    expect(normalized.channels[0].preferences.distributionTargets).toEqual(youtubeOnlyDistributionTargets);
    expect(normalized.videos[0].distributionTargets).toEqual(youtubeOnlyDistributionTargets);
    expect(normalized.videos[0].platformArtifacts).toEqual([]);
  });
});

describe("centralized platform constraints", () => {
  it("uses vertical planning targets and records primary sources", () => {
    expect(platformConstraints.TIKTOK.aspectRatio).toBe("9:16");
    expect(platformConstraints.INSTAGRAM_FACEBOOK_REELS.aspectRatio).toBe("9:16");
    expect(platformConstraints.TIKTOK.sources.every((source) => source.startsWith("https://"))).toBe(true);
    expect(platformConstraints.INSTAGRAM_FACEBOOK_REELS.minimumFrameRate).toBe(30);
  });
});

describe("production persistence migration", () => {
  it("adds target snapshots and owner-isolated RLS for every platform table", () => {
    const sql = readFileSync("supabase/migrations/202608090001_platform_distribution.sql", "utf8");
    expect(sql).toContain("add column distribution_targets");
    for (const table of ["platform_adaptation_artifacts", "platform_qa_reports", "platform_artifact_approvals"]) {
      expect(sql).toContain(`alter table channelwright.${table} enable row level security`);
    }
    expect(sql.match(/create policy platform_/g)).toHaveLength(3);
    expect(sql).toContain("v.owner_id = auth.uid()");
  });
});

it("keeps provider shapes out of the package contract", () => {
  expect(platformPackageSchema.options).toHaveLength(2);
});
