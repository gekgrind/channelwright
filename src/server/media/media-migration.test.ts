import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/202608110001_media_production_pipeline.sql"), "utf8");

describe("media production migration contract", () => {
  it("defines immutable owner-scoped media records and separated QA gates", () => {
    for (const table of ["media_assets", "media_asset_versions", "render_input_versions", "render_jobs", "render_job_attempts", "production_master_versions", "technical_media_inspections", "media_qa_reports", "production_master_approvals", "production_idempotency"]) {
      expect(sql).toContain(`create table channelwright.${table}`);
      expect(sql).toContain(`alter table channelwright.${table} enable row level security`);
    }
    expect(sql).toContain("'TECHNICAL', 'RIGHTS', 'CONTENT', 'VISUAL', 'AUDIO', 'PLATFORM'");
    expect(sql).toContain("check (storage_key like owner_id::text || '/masters/sha256/%')");
  });

  it("uses transactional idempotency and atomic worker leases", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("for update skip locked limit 1");
    expect(sql).toContain("IDEMPOTENCY_CONFLICT");
    expect(sql).toContain("unique (render_job_id)");
    expect(sql).toContain("grant execute on function channelwright.claim_render_job");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("channelwright.production_idempotency from anon, authenticated");
    expect(sql).not.toContain("channelwright.production_idempotency to authenticated");
  });

  it("keeps security-definer dependencies explicit and uses current JWT claims", () => {
    expect(sql).toContain("extensions.digest");
    // Every pgcrypto digest() call must stay schema-qualified. The functions run
    // under `search_path = channelwright, pg_temp`, which excludes the `extensions`
    // schema where pgcrypto lives, so an unqualified digest() would fail at call
    // time (the resolver defect repaired in 202608150002). Qualifying it here is
    // what makes this function immune without widening the search_path.
    // Matched case-insensitively and tolerant of whitespace before `(` so
    // `DIGEST(...)` and `digest (...)` are caught as unqualified too.
    const allDigestCalls = sql.match(/\bdigest\s*\(/gi) ?? [];
    const qualifiedDigestCalls = sql.match(/\bextensions\s*\.\s*digest\s*\(/gi) ?? [];
    expect(allDigestCalls).toHaveLength(qualifiedDigestCalls.length);
    expect(sql).toContain("auth.jwt()->>'role'");
    expect(sql).not.toContain("auth.role()");
    expect(sql).toContain("security definer set search_path = channelwright, pg_temp");
    expect(sql).toContain("revoke all on function channelwright.claim_render_job");
  });

  it("binds lease mutation and exact completion retries to the active holder", () => {
    expect(sql).toContain("and lease_expires_at > now() for update");
    expect(sql).toContain("and lease_token = p_lease_token and status = 'SUCCEEDED'");
    expect(sql).toContain("completion belongs to a different render lease");
    expect(sql).toContain("p_lease_seconds not between 30 and 900");
  });

  it("provides the exact owner key required by media foreign keys", () => {
    expect(sql).toContain("video_projects_id_owner_unique unique (id, owner_id)");
  });

  it("keeps the storage bucket private and signing server-mediated", () => {
    expect(sql).toContain("'channelwright-private-media', 'channelwright-private-media', false");
    expect(sql).toContain("(storage.foldername(name))[1] = auth.uid()::text");
    expect(sql).not.toContain("create policy channelwright_media_owner_insert");
    expect(sql).toContain("function channelwright.inspect_media_storage_reconciliation()");
    expect(sql).toContain("'missingStorageObjects'");
    expect(sql).toContain("'orphanedStorageObjects'");
  });
});
