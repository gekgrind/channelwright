import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/202608120001_supabase_advisor_hardening.sql"), "utf8");

describe("Supabase advisor hardening migration", () => {
  it("fixes mutable search paths and default function execution", () => {
    expect(sql).toContain("alter function channelwright.set_updated_at() set search_path = pg_catalog");
    expect(sql).toContain("revoke execute on functions from public");
  });

  it("rewrites only Channelwright-owned RLS policies to init-plan auth checks", () => {
    expect(sql).toContain("n.nspname = 'channelwright'");
    expect(sql).toContain("p.polname = 'channelwright_media_owner_read'");
    expect(sql).toContain("replace(policy_record.using_expression, 'auth.uid()', '(select auth.uid())')");
    expect(sql).toContain("alter policy %I on %I.%I");
  });

  it("removes the advisor-reported duplicate index", () => {
    expect(sql).toContain("drop constraint if exists concept_versions_id_channel_unique");
  });
});
