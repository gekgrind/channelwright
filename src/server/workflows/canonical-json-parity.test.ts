import { describe, expect, it } from "vitest";
import { canonicalJson, canonicalEquals } from "./canonical-json";
import { videoBriefResultFixture, selectionFixture } from "./video-brief-fixtures.test-helper";

/**
 * Parity between the application's `canonicalJson` and the database's
 * `channelwright.canonical_jsonb_text`.
 *
 * The two must agree or a semantically identical Viewer Value contract would
 * fail provenance verification purely because PostgreSQL reordered JSONB keys.
 * A live cross-check requires a database; these tests prove the property
 * statically for every input the contracts can actually produce.
 *
 * The database sorts with `collate "C"`, which is byte order. For ASCII that is
 * identical to the UTF-16 code-unit order the application uses. The tests below
 * therefore prove (a) every reachable key is ASCII, and (b) byte order and
 * code-unit order agree on those keys.
 *
 * Known and accepted divergence: keys containing astral characters (above
 * U+FFFF) would sort differently, because JS compares UTF-16 code units where a
 * surrogate pair begins at 0xD800, below U+E000-U+FFFF. Every schema in this
 * chain is `.strict()` with fixed ASCII keys, so such a key is unreachable.
 */

function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) { for (const item of value) collectKeys(item, into); return into; }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) { into.add(key); collectKeys(item, into); }
  }
  return into;
}

/** Sibling key sets, which is the granularity at which sort order actually matters. */
function collectSiblingGroups(value: unknown, into: string[][] = []): string[][] {
  if (Array.isArray(value)) { for (const item of value) collectSiblingGroups(item, into); return into; }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length > 1) into.push(keys);
    for (const item of Object.values(value as Record<string, unknown>)) collectSiblingGroups(item, into);
  }
  return into;
}

const byteOrder = (left: string, right: string) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
const codeUnitOrder = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** Deep clone with every object's keys reversed, simulating JSONB reordering. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  }
  return value;
}

const BRIEF = videoBriefResultFixture();
const VIEWER_VALUE_CONTRACT = BRIEF.viewerValue.contract;

describe("canonical JSON parity between application and database", () => {
  it("uses only ASCII keys, so byte order equals UTF-16 code-unit order", () => {
    const keys = [...collectKeys(BRIEF), ...collectKeys(selectionFixture)];
    expect(keys.length).toBeGreaterThan(50);
    const nonAscii = keys.filter((key) => !/^[\x20-\x7E]+$/.test(key));
    expect(nonAscii).toEqual([]);
  });

  it("orders every sibling key group identically under both collations", () => {
    // This is the property that would break provenance if it ever failed: the
    // database sorts with collate "C" (bytes) and the application by code unit.
    const groups = collectSiblingGroups(BRIEF);
    expect(groups.length).toBeGreaterThan(10);
    for (const keys of groups) {
      expect([...keys].sort(byteOrder)).toEqual([...keys].sort(codeUnitOrder));
    }
  });

  it("orders the hashed Viewer Value contract identically under both collations", () => {
    // This exact subtree is what the database hashes into inheritedViewerValueProvenance.
    for (const keys of collectSiblingGroups(VIEWER_VALUE_CONTRACT)) {
      expect([...keys].sort(byteOrder)).toEqual([...keys].sort(codeUnitOrder));
    }
  });

  it("proves the ordering hazard the collate \"C\" fix exists to prevent", () => {
    // A database collation such as en_US.UTF-8 sorts case-insensitively at
    // primary strength, putting originalContribution before originStage, while
    // code-unit order puts originStage first because 'S' (0x53) < 'a' (0x61).
    // Sibling keys drawn from the two orderings must therefore never disagree.
    expect(codeUnitOrder("originStage", "originalContribution")).toBeLessThan(0);
    expect("originStage".toLowerCase() < "originalContribution".toLowerCase()).toBe(false);
    // The real contract must not contain such a colliding sibling pair.
    for (const keys of collectSiblingGroups(BRIEF)) {
      const lowered = keys.map((key) => key.toLowerCase());
      expect(new Set(lowered).size).toBe(keys.length);
    }
  });

  it("produces an identical canonical string when object keys are reordered", () => {
    // JSONB does not preserve insertion order; this is the behaviour that must
    // not be mistaken for tampering.
    const reordered = reverseKeys(VIEWER_VALUE_CONTRACT);
    expect(canonicalJson(reordered)).toBe(canonicalJson(VIEWER_VALUE_CONTRACT));
    expect(canonicalEquals(reordered, VIEWER_VALUE_CONTRACT)).toBe(true);
  });

  it("preserves array order, which is semantically meaningful", () => {
    const contract = VIEWER_VALUE_CONTRACT;
    const flipped = { ...contract, valuePromise: { ...contract.valuePromise, kinds: [...contract.valuePromise.kinds].reverse() } };
    if (contract.valuePromise.kinds.length > 1) {
      expect(canonicalEquals(flipped, contract)).toBe(false);
    }
  });

  it("serializes scalars the way the database function does", () => {
    // The database returns p_value::text for these, which matches JSON.stringify.
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(false)).toBe("false");
    expect(canonicalJson(1)).toBe("1");
    expect(canonicalJson("text")).toBe('"text"');
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson([])).toBe("[]");
  });

  it("agrees with trim_scale on numeric representation", () => {
    // jsonb keeps numeric scale: 1.50::jsonb::text is "1.50" while
    // JSON.stringify(1.50) is "1.5". The migration applies trim_scale so both
    // sides emit the same digits.
    expect(canonicalJson(1.5)).toBe("1.5");
    expect(canonicalJson(1.0)).toBe("1");
    expect(canonicalJson(0.2)).toBe("0.2");
  });

  it("detects a changed promise, which is the point of the hash", () => {
    const tampered = {
      ...VIEWER_VALUE_CONTRACT,
      valuePromise: { ...VIEWER_VALUE_CONTRACT.valuePromise, statement: "A quietly different promise." },
    };
    expect(canonicalEquals(tampered, VIEWER_VALUE_CONTRACT)).toBe(false);
  });
});
