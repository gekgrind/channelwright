// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DistributionTargetControls } from "./studio-app";

afterEach(cleanup);

describe("distribution target controls", () => {
  it("uses accessible checkboxes with required YouTube locked and optional targets off", () => {
    render(<DistributionTargetControls />);
    const youtube = screen.getByRole("checkbox", { name: /YouTube REQUIRED/i }) as HTMLInputElement;
    const tiktok = screen.getByRole("checkbox", { name: /^TikTok/i }) as HTMLInputElement;
    const reels = screen.getByRole("checkbox", { name: /Instagram\/Facebook Reels/i }) as HTMLInputElement;
    expect(youtube.checked).toBe(true);
    expect(youtube.disabled).toBe(true);
    expect(tiktok.checked).toBe(false);
    expect(reels.checked).toBe(false);
    expect(tiktok.type).toBe("checkbox");
    expect(reels.type).toBe("checkbox");
  });
});
