import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = [
  "supabase/migrations/202608130003_channel_research.sql",
  "supabase/migrations/202608130004_research_usage_accounting.sql",
].map((path) => readFileSync(resolve(process.cwd(), path), "utf8")).join("\n").toLowerCase();

describe("CHANNEL_RESEARCH migration", () => {
  it("adds only Channelwright-owned research objects and preserves the schema boundary", () => {
    expect(migration).toContain("create table channelwright.research_evidence_cache");
    expect(migration).not.toMatch(/create table public\./);
    expect(migration).not.toMatch(/alter table public\./);
  });

  it("keeps cache data owner-scoped and authenticated writes revoked", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("owner_id = (select auth.uid())");
    expect(migration).toContain("revoke insert, update, delete on channelwright.research_evidence_cache from authenticated");
    expect(migration).toContain("purge_expired_research_cache");
    expect(migration).toContain("research cache maintenance requires service role");
  });

  it("registers the new workflow and a persisted revision-request state", () => {
    expect(migration).toContain("'channel_research'");
    expect(migration).toContain("'revision_requested'");
    expect(migration).toContain("p_decision not in ('approve','reject','request_revision')");
    expect(migration).toContain("security definer set search_path = channelwright, pg_temp");
    expect(migration).toContain("canonical workflow definition required");
    expect(migration).toContain("research_limit_reached");
    expect(migration).toContain("workflow_revision_queued");
    expect(migration).toContain("previousrunid");
  });
});
