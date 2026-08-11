import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalizeYouTubeChannelUrl, UnsupportedYouTubeChannelUrlError } from "./youtube-channel-url";

describe("YouTube reference-channel URLs", () => {
  it.each([
    ["https://youtube.com/@Channel.Name?sub_confirmation=1", "https://www.youtube.com/@Channel.Name", "HANDLE"],
    ["http://m.youtube.com/channel/UC1234567890_abc", "https://www.youtube.com/channel/UC1234567890_abc", "CHANNEL_ID"],
    ["https://www.youtube.com/c/ExampleStudio", "https://www.youtube.com/c/ExampleStudio", "CUSTOM_PATH"],
    ["https://youtube.com/user/ExampleUser", "https://www.youtube.com/user/ExampleUser", "USER_PATH"],
  ])("canonicalizes %s", (input, canonicalUrl, sourceKind) => {
    expect(canonicalizeYouTubeChannelUrl(input)).toMatchObject({ canonicalUrl, sourceKind });
  });

  it.each([
    "https://youtu.be/video-id",
    "https://youtube.com/watch?v=video-id",
    "https://youtube.com.evil.example/@handle",
    "file:///etc/passwd",
    "https://user:secret@youtube.com/@handle",
  ])("rejects unsupported or unsafe input %s", (input) => {
    expect(() => canonicalizeYouTubeChannelUrl(input)).toThrow(UnsupportedYouTubeChannelUrlError);
  });
});

describe("business-studio migration", () => {
  it("creates owner-scoped RLS for every new mutable aggregate", () => {
    const sql = readFileSync("supabase/migrations/202608100001_business_studio_foundation.sql", "utf8");
    const tables = [
      "reference_channel_sources", "reference_research_report_versions", "reference_report_decisions", "business_strategy_versions", "business_strategy_decisions",
      "brand_system_versions", "pillar_video_plans", "offer_candidates", "offer_selections", "build_projects",
      "build_artifact_versions", "artifact_decisions", "funnel_page_versions", "subscribers", "consent_events",
      "delivery_events", "products", "prices", "purchases", "entitlements", "commerce_events", "monetization_plan_versions",
      "monetization_plan_decisions", "conversation_messages", "structured_change_requests",
    ];
    for (const table of tables) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql.match(/owner_id uuid not null references auth\.users/g)?.length).toBeGreaterThanOrEqual(tables.length);
    expect(sql).toContain("object_reference text");
    expect(sql).not.toContain("binary_payload");
    expect(sql).toContain("foreign key (offer_candidate_id, owner_id, channel_id)");
    expect(sql).toContain("foreign key (build_project_id, owner_id, channel_id)");
    expect(sql).toContain("foreign key (message_id, owner_id, channel_id)");
  });
});
