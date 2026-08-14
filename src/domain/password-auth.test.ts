import { describe, expect, it } from "vitest";
import { classifySupabaseAuthError, parsePasswordLogin } from "./password-auth";

describe("password authentication boundary", () => {
  it("requires a CAPTCHA token for production password login", () => {
    expect(parsePasswordLogin({ email: "operator@example.com", password: "secret12" }, true).success).toBe(false);
    expect(parsePasswordLogin({ email: "operator@example.com", password: "secret12", captchaToken: "verified-token-value" }, true).success).toBe(true);
  });

  it("keeps the local fixture login CAPTCHA-free", () => {
    expect(parsePasswordLogin({ email: "operator@example.com", password: "secret12" }, false).success).toBe(true);
  });

  it("rejects malformed and oversized boundary values", () => {
    expect(parsePasswordLogin({ email: "not-an-email", password: "secret12", captchaToken: "verified-token-value" }, true).success).toBe(false);
    expect(parsePasswordLogin({ email: "operator@example.com", password: "secret12", captchaToken: "x".repeat(4_097) }, true).success).toBe(false);
  });

  it("maps CAPTCHA failures without exposing provider detail", () => {
    expect(classifySupabaseAuthError({ message: "captcha verification process failed" })).toBe("captcha_failed");
    expect(classifySupabaseAuthError({ message: "Invalid login credentials" })).toBe("auth");
    expect(classifySupabaseAuthError({ message: "network fetch failed" })).toBe("unavailable");
    expect(classifySupabaseAuthError(null)).toBeNull();
  });
});

