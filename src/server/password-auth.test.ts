import { describe, expect, it, vi } from "vitest";
import { signInWithCaptcha } from "./password-auth";

describe("Supabase CAPTCHA plumbing", () => {
  it("passes the completed token through Supabase's password-auth options", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    await signInWithCaptcha({ auth: { signInWithPassword } }, {
      email: "operator@example.com",
      password: "secret12",
      captchaToken: "provider-verification-token",
    });
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "operator@example.com",
      password: "secret12",
      options: { captchaToken: "provider-verification-token" },
    });
  });

  it("never calls Supabase when the token is missing", async () => {
    const signInWithPassword = vi.fn();
    await expect(signInWithCaptcha({ auth: { signInWithPassword } }, {
      email: "operator@example.com",
      password: "secret12",
    })).rejects.toThrow("CAPTCHA_TOKEN_REQUIRED");
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});

