import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationRoot = path.resolve(process.cwd(), "supabase/migrations");
const migrations = readdirSync(migrationRoot)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(path.join(migrationRoot, name), "utf8") }));

describe("shared-project schema isolation", () => {
  it("keeps every Channelwright relational object out of public", () => {
    for (const migration of migrations) {
      expect(migration.sql, migration.name).not.toMatch(/\bpublic\./);
      expect(migration.sql, migration.name).not.toContain("schema public");
      expect(migration.sql, migration.name).not.toContain("search_path = public");
    }
  });

  it("creates and grants the dedicated schema before application objects", () => {
    const initial = migrations[0].sql;
    expect(initial).toContain("create schema if not exists channelwright");
    expect(initial).toContain("grant usage on schema channelwright to authenticated, service_role");
    expect(initial.indexOf("create schema if not exists channelwright")).toBeLessThan(initial.indexOf("create type channelwright.concept_source"));
  });

  it("places the otherwise-colliding entitlement table inside Channelwright", () => {
    expect(migrations.map((item) => item.sql).join("\n")).toContain("create table channelwright.entitlements");
  });
});
