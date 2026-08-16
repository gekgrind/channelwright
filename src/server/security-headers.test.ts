import { describe, expect, it } from "vitest";
import nextConfig, { contentSecurityPolicy } from "../../next.config";

describe("application security headers", () => {
  it("prevents clickjacking without blocking the configured CAPTCHA script provider", async () => {
    const entries = await nextConfig.headers?.();
    const headers = new Map(entries?.flatMap((entry) => entry.headers.map((header) => [header.key, header.value] as const)));
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("restricts script, object, and connect sources and enforces transport security", async () => {
    const entries = await nextConfig.headers?.();
    const headers = new Map(entries?.flatMap((entry) => entry.headers.map((header) => [header.key, header.value] as const)));
    const policy = headers.get("Content-Security-Policy") ?? "";
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("https://challenges.cloudflare.com");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=63072000");
  });

  it("allows the configured Supabase origin without widening connect-src to every host", () => {
    const policy = contentSecurityPolicy("production", "https://project.supabase.co");
    expect(policy).toContain("connect-src 'self' https://project.supabase.co wss://project.supabase.co");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("*");
  });
});
