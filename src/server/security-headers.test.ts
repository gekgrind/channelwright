import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("application security headers", () => {
  it("prevents clickjacking without blocking the configured CAPTCHA script provider", async () => {
    const entries = await nextConfig.headers?.();
    const headers = new Map(entries?.flatMap((entry) => entry.headers.map((header) => [header.key, header.value] as const)));
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
