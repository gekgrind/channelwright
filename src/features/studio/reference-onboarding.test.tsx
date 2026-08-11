// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NewChannelForm } from "./studio-app";

afterEach(cleanup);

describe("reference-channel onboarding", () => {
  it("presents three distinct modes and reveals the reference-specific controls", () => {
    render(<NewChannelForm busy={false} onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: /I have a concept/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Discover opportunities/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Use a reference channel/i }));
    expect((screen.getByRole("textbox", { name: /YouTube channel URL/i }) as HTMLInputElement).type).toBe("url");
    expect(screen.getByRole("textbox", { name: /What do you value/i })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /What must not be imitated/i })).toBeTruthy();
    expect(screen.getByText(/market input only/i)).toBeTruthy();
  });

  it("submits typed reference input and production preferences", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<NewChannelForm busy={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /Use a reference channel/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /YouTube channel URL/i }), { target: { value: "https://youtube.com/@reference-example" } });
    fireEvent.change(screen.getByLabelText(/Production complexity/i), { target: { value: "LEAN" } });
    fireEvent.click(screen.getByRole("button", { name: /Research reference and propose/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      type: "CREATE_CHANNEL", mode: "REFERENCE_CHANNEL",
      referenceChannel: { url: "https://youtube.com/@reference-example" },
      preferences: { language: "English", productionComplexity: "LEAN" },
    });
  });

  it("retains visible keyboard focus and collapses the three-pane workspace at responsive breakpoints", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(":focus-visible { outline: 3px solid var(--orange)");
    expect(css).toMatch(/@media \(max-width: 1150px\)[\s\S]*?\.workspace-grid \{ grid-template-columns: 1fr;/);
    expect(css).toMatch(/@media \(max-width: 850px\)[\s\S]*?\.workspace-grid \{ display: block;/);
  });
});
