/**
 * Deterministic, key-order-independent serialization for provenance-significant
 * comparisons. `JSON.stringify` preserves insertion order, so two structurally
 * identical references can serialize differently and fail an equality check that
 * is meant to detect tampering, not key ordering.
 *
 * Object keys are sorted by UTF-16 code unit (not locale) so the output is
 * stable across runtimes and locales. `undefined` object members are dropped,
 * matching `JSON.stringify`; `undefined` inside arrays becomes `null`, also
 * matching `JSON.stringify`.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/** Structural equality for provenance records, independent of key order. */
export function canonicalEquals(left: unknown, right: unknown) {
  return canonicalJson(left) === canonicalJson(right);
}
