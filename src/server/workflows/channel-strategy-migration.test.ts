import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/202608140001_channel_strategy.sql", "utf8").toLowerCase();

describe("CHANNEL_STRATEGY migration", () => {
  it("extends the canonical workflow and exact approved-research boundary", () => {
    expect(migration).toContain("'channel_strategy'");
    expect(migration).toContain("resolve_approved_research_artifact");
    expect(migration).toContain("upstream_research_integrity_mismatch");
    expect(migration).toContain("jsonb_object_length(p_input) <> 2");
  });

  it("schema-qualifies digest() in the apply-time backfill so a clean cluster can apply it", () => {
    // Regression: the top-level backfill runs at migration apply time, so bare
    // digest() is resolved via the session search_path. On a cluster where
    // pgcrypto's `extensions` schema is not on that path it raises
    // "function digest(text, unknown) does not exist" and aborts the whole chain
    // (caught by the disposable-PostgreSQL gate). It must stay schema-qualified.
    expect(migration).toContain("encode(extensions.digest(r.output_payload::text, 'sha256'), 'hex')");
    expect(migration).toContain("encode(extensions.digest(e.output_payload::text, 'sha256'), 'hex')");
  });

  it("reuses durable accounting, successor lineage, and immutable final artifacts", () => {
    expect(migration).toContain("ensure_research_run_budget");
    expect(migration).toContain("'human-revision:'||v_old_run.id::text");
    expect(migration).toContain("artifact_hash");
    expect(migration).toContain("provenance_hash");
    expect(migration).toContain("workflow_approvals_protect_final");
  });
});
