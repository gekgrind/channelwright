// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth", () => auth);
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }) }));

import ReviewPreviewPage from "./studio/preview/review/page";
import { notFound } from "next/navigation";
import { ReviewPreview } from "@/features/studio/review-preview";

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers(); });

const page = (kind?: string, outcome?: string) => ReviewPreviewPage({ searchParams: Promise.resolve({ kind, outcome }) });

describe("ReviewScreen fixture preview access", () => {
  it("does not exist in production, even when fixture mode is requested, and checks that before sign-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
    await expect(page()).rejects.toThrow("NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
    expect(auth.requireUser).not.toHaveBeenCalled();
  });

  it("does not exist when fixture mode is disabled", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "false");
    await expect(page()).rejects.toThrow("NOT_FOUND");
    expect(auth.requireUser).not.toHaveBeenCalled();
  });

  it("requires a signed-in user in fixture mode", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
    auth.requireUser.mockRejectedValue(new Error("LOGIN_REQUIRED"));
    await expect(page()).rejects.toThrow("LOGIN_REQUIRED");
  });

  it("renders the requested kind and outcome, and falls back for unknown keys", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
    auth.requireUser.mockResolvedValue({ id: "fixture", email: "operator@example.com", mode: "mock" });
    expect((await page("experiment", "stale")).props).toEqual({ kind: "experiment", outcome: "stale" });
    expect((await page("constructor", "toString")).props).toEqual({ kind: "performance", outcome: "success" });
  });
});

describe("ReviewScreen fixture preview behavior", () => {
  it.each(["success", "stale", "network", "unauthorized"] as const)("sends no request for any dialog with the %s outcome", async (outcome) => {
    vi.useFakeTimers();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<ReviewPreview kind="decision" outcome={outcome} />);
    for (const action of ["approve", "revise", "reject"]) {
      fireEvent.click(document.querySelector(`[data-review-action="${action}"]`)!);
      const modal = screen.queryByRole("dialog") ?? screen.getByRole("alertdialog");
      if (action === "revise") fireEvent.change(within(modal).getByLabelText(/what should change/i), { target: { value: "Narrow the claim." } });
      const confirm = within(modal).getAllByRole("button").at(-1)!;
      fireEvent.click(confirm);
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      const open = screen.queryByRole("dialog") ?? screen.queryByRole("alertdialog");
      const reload = open ? within(open).queryByRole("button", { name: /reload current state/i }) : null;
      if (outcome === "success") { fireEvent.click(screen.getByRole("button", { name: /reset fixture/i })); continue; }
      if (reload) fireEvent.click(reload);
      else fireEvent.click(within(open!).getByRole("button", { name: /^(close|cancel)$/i }));
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("moves focus to the fixture's status notice after a successful decision", async () => {
    vi.useFakeTimers();
    render(<ReviewPreview kind="experiment" outcome="success" />);
    fireEvent.click(document.querySelector(`[data-review-action="approve"]`)!);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^approve experiment plan v2$/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByRole("status")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(/APPROVE recorded on Experiment plan v2 \(fixture: nothing was sent\)/);
  });
});
