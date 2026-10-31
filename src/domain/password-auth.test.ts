import { describe, expect, it } from "vitest";
import { classifySupabaseAuthError, describeAuthException, describeSupabaseAuthError, parsePasswordLogin } from "./password-auth";

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

  it.each([
    // GoTrue rejection codes for POST /token?grant_type=password.
    [{ code: "invalid_credentials", status: 400, message: "Invalid login credentials" }, "auth"],
    [{ code: "email_not_confirmed", status: 400, message: "Email not confirmed" }, "auth"],
    [{ code: "user_banned", status: 400, message: "User is banned" }, "auth"],
    [{ code: "over_request_rate_limit", status: 429, message: "Request rate limit reached" }, "auth"],
    [{ code: "captcha_failed", status: 400, message: "request disallowed" }, "captcha_failed"],
    [{ status: 0, message: "fetch failed" }, "unavailable"],
  ])("classifies the provider rejection %o as %s", (error, classification) => {
    expect(classifySupabaseAuthError(error)).toBe(classification);
    expect(describeSupabaseAuthError(error).classification).toBe(classification);
  });

  it("describes provider rejections with only a known-shape code and a valid HTTP status", () => {
    expect(describeSupabaseAuthError({ code: "invalid_credentials", status: 400, message: "Invalid login credentials" }))
      .toEqual({ classification: "auth", providerCode: "invalid_credentials", providerStatus: 400 });
    expect(describeSupabaseAuthError({ code: "operator@example.com", status: 400 }).providerCode).toBe("unrecognized");
    expect(describeSupabaseAuthError({ code: "Bad Code", status: 400 }).providerCode).toBe("unrecognized");
    expect(describeSupabaseAuthError({ code: "x".repeat(65) }).providerCode).toBe("unrecognized");
    expect(describeSupabaseAuthError({ message: "no code" })).toEqual({ classification: "auth", providerCode: undefined, providerStatus: undefined });
    expect(describeSupabaseAuthError({ code: "invalid_credentials", status: 0 }).providerStatus).toBeUndefined();
    expect(describeSupabaseAuthError({ code: "invalid_credentials", status: 400.5 }).providerStatus).toBeUndefined();
    expect(JSON.stringify(describeSupabaseAuthError({ code: "invalid_credentials", message: "secret-detail" }))).not.toContain("secret-detail");
  });

  it("describes thrown failures by class name and status, never message", () => {
    expect(describeAuthException(Object.assign(new Error("token=abc"), { name: "AuthRetryableFetchError", status: 503 }))).toEqual({ errorName: "AuthRetryableFetchError", providerStatus: 503 });
    expect(describeAuthException(new TypeError("fetch failed"))).toEqual({ errorName: "TypeError", providerStatus: undefined });
    expect(describeAuthException(Object.assign(new Error("x"), { name: "contains space" })).errorName).toBe("Error");
    expect(describeAuthException("password in a string")).toEqual({ errorName: "Error", providerStatus: undefined });
    expect(describeAuthException(null)).toEqual({ errorName: "Error", providerStatus: undefined });
  });
});

