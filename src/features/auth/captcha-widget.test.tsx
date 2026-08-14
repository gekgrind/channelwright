// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptchaWidget } from "./captcha-widget";

afterEach(() => {
  document.head.querySelectorAll("script[id^='channelwright-']").forEach((script) => script.remove());
  delete window.turnstile;
  vi.restoreAllMocks();
});

describe("CAPTCHA widget boundary", () => {
  it("stores a completed provider token for the server form", async () => {
    let verify: ((token: string) => void) | undefined;
    window.turnstile = {
      render: vi.fn((_element, options) => {
        verify = options.callback as (token: string) => void;
        return "widget-1";
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    const { container } = render(<CaptchaWidget provider="turnstile" siteKey="public-site-key" />);
    await act(async () => verify?.("completed-provider-token"));
    expect(container.querySelector<HTMLInputElement>('input[name="captchaToken"]')?.value).toBe("completed-provider-token");
    expect(screen.getByText("Security check complete.")).toBeTruthy();
  });

  it("clears expired tokens and offers a retry", async () => {
    let verify: ((token: string) => void) | undefined;
    let expire: (() => void) | undefined;
    const reset = vi.fn();
    window.turnstile = {
      render: vi.fn((_element, options) => {
        verify = options.callback as (token: string) => void;
        expire = options["expired-callback"] as () => void;
        return "widget-2";
      }),
      reset,
    };
    const { container } = render(<CaptchaWidget provider="turnstile" siteKey="public-site-key" />);
    await act(async () => verify?.("short-lived-token"));
    await act(async () => expire?.());
    expect(container.querySelector<HTMLInputElement>('input[name="captchaToken"]')?.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Retry security check" }));
    expect(reset).toHaveBeenCalledWith("widget-2");
  });
});

