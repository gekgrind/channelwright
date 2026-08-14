// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordLoginForm } from "./password-login-form";

afterEach(() => {
  cleanup();
  document.head.querySelectorAll("script[id^='channelwright-']").forEach((script) => script.remove());
  delete window.turnstile;
});

describe("production password login form", () => {
  it("keeps submit disabled until the provider returns a token", async () => {
    let verify: ((token: string) => void) | undefined;
    window.turnstile = { render: vi.fn((_element, options) => { verify = options.callback as (token: string) => void; return "widget-login"; }), reset: vi.fn() };
    render(<PasswordLoginForm provider="turnstile" siteKey="public-site-key" />);
    const submit = screen.getByRole("button", { name: /enter studio/i });
    expect(submit).toHaveProperty("disabled", true);
    await act(async () => verify?.("completed-provider-token"));
    expect(submit).toHaveProperty("disabled", false);
  });

  it("fails closed when public widget configuration is absent", () => {
    render(<PasswordLoginForm provider={null} />);
    expect(screen.getByRole("alert").textContent).toContain("not configured");
    expect(screen.getByRole("button", { name: /enter studio/i })).toHaveProperty("disabled", true);
  });
});
