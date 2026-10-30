// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { ReviewScreen } from "./review-screen";
import { REVIEW_KINDS, type ReviewKindKey } from "./review-kinds";
import type { DecisionOutcome, DecisionTarget } from "./workflow-api";

afterEach(cleanup);

const TARGET_A: DecisionTarget = { workflowId: "wf-a", runId: "run-a", approvalId: "ap-a", key: "wf-a:run-a:ap-a" };
const TARGET_B: DecisionTarget = { workflowId: "wf-b", runId: "run-b", approvalId: "ap-b", key: "wf-b:run-b:ap-b" };
type Decide = (target: DecisionTarget, decision: string, note: string | undefined) => Promise<DecisionOutcome>;

function screenFor({ kind = "CHANNEL_VIDEO_SCRIPT" as ReviewKindKey, target = TARGET_A, onDecide = vi.fn<Decide>(async () => ({ ok: true })), onReload = vi.fn(), locked = false, busy = false } = {}) {
  return { onDecide, onReload, element: <ReviewScreen kind={kind} target={target} versionNumber={2} busy={busy} locked={locked} explanation="Approving accepts the script." revisionPlaceholder="What should change?" onDecide={onDecide} onReload={onReload} /> };
}
function renderScreen(options: Parameters<typeof screenFor>[0] = {}) {
  const built = screenFor(options);
  const view = render(built.element);
  return { ...built, ...view };
}
// Entry controls live in the review region; confirm controls live in the open dialog.
const entry = (action: string) => {
  const element = document.querySelector<HTMLButtonElement>(`[data-review-action="${action}"]`);
  if (!element) throw new Error(`no ${action} entry control`);
  return element;
};
const approve = () => entry("approve");
const revise = () => entry("revise");
const reject = () => entry("reject");
const openDialog = () => screen.queryByRole("dialog") ?? screen.queryByRole("alertdialog");
const inDialog = (name: RegExp) => within(openDialog()!).getByRole("button", { name });

describe("ReviewScreen entry points", () => {
  it.each(Object.keys(REVIEW_KINDS) as ReviewKindKey[])("renders exactly one Approve, one Request revision, and one Reject for %s, hidden or not", (kind) => {
    const { container } = renderScreen({ kind });
    for (const action of ["approve", "revise", "reject"]) expect(container.querySelectorAll(`[data-review-action="${action}"]`)).toHaveLength(1);
    // Every Approve-named control in the whole document, including any hidden copy.
    expect(screen.getAllByRole("button", { name: /^approve/i, hidden: true })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^approve/i })).toHaveTextContent(`Approve ${REVIEW_KINDS[kind].versionNoun} v2`);
  });

  it("never sends anything on the first click of any action", () => {
    const { onDecide } = renderScreen();
    fireEvent.click(approve());
    fireEvent.click(inDialog(/^cancel$/i));
    fireEvent.click(revise());
    fireEvent.click(inDialog(/^cancel$/i));
    fireEvent.click(reject());
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("withholds every action while a decision is locked, and offers a reload instead", () => {
    const { onReload } = renderScreen({ locked: true });
    expect(approve()).toBeDisabled();
    expect(revise()).toBeDisabled();
    expect(reject()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/reload to see its current state/i);
    fireEvent.click(screen.getByRole("button", { name: /reload current state/i }));
    expect(onReload).toHaveBeenCalledOnce();
  });
});

describe("ReviewScreen confirmations", () => {
  it("Approve confirms first, names the exact version and what approval does, then sends APPROVE", async () => {
    const { onDecide } = renderScreen({ kind: "CHANNEL_VIDEO_EXPERIMENT" });
    fireEvent.click(screen.getByRole("button", { name: /^approve experiment plan v2$/i }));
    const modal = screen.getByRole("dialog", { name: /approve experiment plan v2\?/i });
    expect(modal).toHaveAttribute("aria-modal", "true");
    expect(modal).toHaveTextContent(/nothing is run, scheduled, or measured/i);
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole("button", { name: /^approve experiment plan v2$/i }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith(TARGET_A, "APPROVE", undefined));
    await waitFor(() => expect(openDialog()).toBeNull());
  });

  it("Request revision states that it starts another paid AI run without estimating cost, and requires a note", async () => {
    const { onDecide } = renderScreen();
    fireEvent.click(revise());
    const modal = screen.getByRole("alertdialog", { name: /request a revision of script v2\?/i });
    expect(modal).toHaveTextContent(/starts another AI generation run that uses paid model calls/i);
    expect(modal).toHaveTextContent(/does not estimate the cost/i);
    expect(modal).not.toHaveTextContent(/\$\s?\d/);
    expect(modal).not.toHaveTextContent(/youtube retrieval/i);
    const note = within(modal).getByLabelText(/what should change/i);
    expect(note).toHaveFocus();

    const confirm = within(modal).getByRole("button", { name: /request revision and start a new run/i });
    fireEvent.click(confirm);
    expect(onDecide).not.toHaveBeenCalled();
    expect(note).toHaveAttribute("aria-invalid", "true");
    expect(note).toHaveAccessibleDescription(/write what should change/i);

    fireEvent.change(note, { target: { value: "   Cut the second example.  " } });
    expect(note).not.toHaveAttribute("aria-invalid");
    fireEvent.click(confirm);
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith(TARGET_A, "REQUEST_REVISION", "Cut the second example."));
  });

  it("names repeated YouTube retrieval for kinds whose revision re-runs it", () => {
    renderScreen({ kind: "CHANNEL_RESEARCH" });
    fireEvent.click(revise());
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/repeats YouTube retrieval, which uses provider quota/i);
  });

  it("Reject explains the terminal consequence and what stays approved, starts on Cancel, and sends the optional reason", async () => {
    const { onDecide } = renderScreen();
    fireEvent.click(reject());
    const modal = screen.getByRole("alertdialog", { name: /reject script v2\?/i });
    expect(modal).toHaveTextContent(/can no longer be approved or revised/i);
    expect(modal).toHaveTextContent(REVIEW_KINDS.CHANNEL_VIDEO_SCRIPT.rejectKeeps);
    expect(within(modal).getByRole("button", { name: /^cancel$/i })).toHaveFocus();
    fireEvent.change(within(modal).getByLabelText(/reason/i), { target: { value: "Wrong audience entirely." } });
    fireEvent.click(within(modal).getByRole("button", { name: /^reject script v2$/i }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith(TARGET_A, "REJECT", "Wrong audience entirely."));
  });

  it("omits an empty rejection reason rather than sending a blank note", async () => {
    const { onDecide } = renderScreen();
    fireEvent.click(reject());
    fireEvent.click(inDialog(/^reject script v2$/i));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith(TARGET_A, "REJECT", undefined));
  });

  it("styles destructive confirmation distinctly from revision", () => {
    renderScreen();
    expect(reject()).toHaveClass("button-danger");
    expect(revise()).not.toHaveClass("button-danger");
    fireEvent.click(reject());
    expect(inDialog(/^reject script v2$/i)).toHaveClass("button-danger-solid");
  });
});

describe("ReviewScreen dialog focus", () => {
  it("Cancel and Escape send nothing and return focus to the invoking control", () => {
    const { onDecide } = renderScreen();
    for (const [invoker, close] of [[approve, "cancel"], [reject, "escape"], [revise, "escape"]] as const) {
      fireEvent.click(invoker());
      if (close === "cancel") fireEvent.click(inDialog(/^cancel$/i));
      else fireEvent.keyDown(openDialog()!, { key: "Escape" });
      expect(openDialog()).toBeNull();
      expect(invoker()).toHaveFocus();
    }
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("traps Tab and Shift+Tab inside the dialog and makes the page behind it inert", () => {
    const { container } = renderScreen();
    fireEvent.click(reject());
    const modal = screen.getByRole("alertdialog");
    const buttons = within(modal).getAllByRole("button");
    const first = within(modal).getByLabelText(/reason/i);
    const last = buttons[buttons.length - 1];
    last.focus();
    fireEvent.keyDown(modal, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(modal, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    expect(container).toHaveAttribute("inert");
    expect(modal.closest("[inert]")).toBeNull();
    fireEvent.keyDown(modal, { key: "Escape" });
    expect(container).not.toHaveAttribute("inert");
  });

  it("does not pull focus back to the invoker after success: the workspace notice owns it", async () => {
    renderScreen();
    fireEvent.click(approve());
    fireEvent.click(inDialog(/^approve script v2$/i));
    await waitFor(() => expect(openDialog()).toBeNull());
    expect(approve()).not.toHaveFocus();
  });
});

describe("ReviewScreen submission safety", () => {
  it("sends exactly one mutation on rapid repeated confirms, and cannot be dismissed while sending", async () => {
    let resolve: (value: DecisionOutcome) => void = () => undefined;
    const onDecide = vi.fn<Decide>(() => new Promise<DecisionOutcome>((done) => { resolve = done; }));
    renderScreen({ onDecide });
    fireEvent.click(approve());
    const confirm = inDialog(/^approve script v2$/i);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.keyDown(confirm, { key: "Enter" });
    fireEvent.click(confirm);
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toHaveTextContent(/sending your decision on script v2/i);
    // The submitting confirm stays focusable (aria-disabled), and Escape/Cancel do nothing.
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).not.toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(inDialog(/^cancel$/i));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => { resolve({ ok: true }); });
    await waitFor(() => expect(openDialog()).toBeNull());
    expect(onDecide).toHaveBeenCalledTimes(1);
  });

  it("on a stale conflict, keeps the dialog with the truthful message, blocks resending, and reloads only when asked", async () => {
    const onDecide = vi.fn<Decide>(async () => ({ ok: false, reason: "stale", message: "Nothing was recorded by this request. This approval can no longer be decided from this screen." }));
    const { onReload } = renderScreen({ onDecide });
    fireEvent.click(approve());
    const confirm = inDialog(/^approve script v2$/i);
    fireEvent.click(confirm);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/nothing was recorded by this request/i);
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(confirm);
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onReload).not.toHaveBeenCalled();
    expect(inDialog(/^close$/i)).toHaveFocus();
    fireEvent.click(within(alert).getByRole("button", { name: /reload current state/i }));
    expect(onReload).toHaveBeenCalledOnce();
    expect(openDialog()).toBeNull();
  });

  it("on an unconfirmed outcome (e.g. network failure), never shows success and keeps the typed note", async () => {
    const onDecide = vi.fn<Decide>(async () => ({ ok: false, reason: "unconfirmed", message: "Channelwright couldn't confirm whether this decision was recorded." }));
    renderScreen({ onDecide });
    fireEvent.click(revise());
    fireEvent.change(screen.getByLabelText(/what should change/i), { target: { value: "Tighten the cold open." } });
    fireEvent.click(inDialog(/request revision and start a new run/i));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't confirm whether this decision was recorded/i);
    expect(screen.getByLabelText(/what should change/i)).toHaveValue("Tighten the cold open.");
    expect(inDialog(/request revision and start a new run/i)).toHaveAttribute("aria-disabled", "true");
  });

  it("treats a thrown decision handler as unconfirmed, not as success", async () => {
    const onDecide = vi.fn<Decide>(async () => { throw new Error("boom"); });
    renderScreen({ onDecide });
    fireEvent.click(reject());
    fireEvent.click(inDialog(/^reject script v2$/i));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't confirm whether this decision was recorded/i);
  });

  it("allows a corrected resend after a validation failure", async () => {
    const onDecide = vi.fn<Decide>()
      .mockResolvedValueOnce({ ok: false, reason: "validation", message: "Nothing was recorded: Invalid workflow approval request." })
      .mockResolvedValueOnce({ ok: true });
    renderScreen({ onDecide });
    fireEvent.click(reject());
    const confirm = inDialog(/^reject script v2$/i);
    fireEvent.click(confirm);
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid workflow approval request/i);
    expect(confirm).not.toHaveAttribute("aria-disabled");
    fireEvent.click(confirm);
    await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(2));
  });

  it("on an authorization failure, says nothing was recorded and does not offer a resend", async () => {
    const onDecide = vi.fn<Decide>(async () => ({ ok: false, reason: "unauthorized", message: "Nothing was recorded: you need to sign in again before deciding." }));
    renderScreen({ onDecide });
    fireEvent.click(approve());
    fireEvent.click(inDialog(/^approve script v2$/i));
    expect(await screen.findByRole("alert")).toHaveTextContent(/sign in again/i);
    expect(inDialog(/^approve script v2$/i)).toHaveAttribute("aria-disabled", "true");
  });
});

describe("ReviewScreen target identity", () => {
  it("never carries an open dialog, its note, or a failure to a different target", async () => {
    const onDecide = vi.fn<Decide>(async () => ({ ok: true }));
    const first = screenFor({ onDecide });
    const { rerender } = render(first.element);
    fireEvent.click(revise());
    fireEvent.change(screen.getByLabelText(/what should change/i), { target: { value: "Notes meant for run A." } });

    rerender(screenFor({ onDecide, target: TARGET_B }).element);
    expect(openDialog()).toBeNull();
    fireEvent.click(revise());
    expect(screen.getByLabelText(/what should change/i)).toHaveValue("");
    fireEvent.click(inDialog(/^cancel$/i));
    fireEvent.click(reject());
    fireEvent.click(inDialog(/^reject script v2$/i));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith(TARGET_B, "REJECT", undefined));
    expect(onDecide).toHaveBeenCalledTimes(1);
  });

  it("an in-flight submission is never inherited by the next target's controls", async () => {
    let finish: (value: DecisionOutcome) => void = () => undefined;
    const onDecide = vi.fn<Decide>(() => new Promise<DecisionOutcome>((done) => { finish = done; }));
    const { rerender } = render(screenFor({ onDecide }).element);
    fireEvent.click(approve());
    fireEvent.click(inDialog(/^approve script v2$/i));
    expect(onDecide).toHaveBeenCalledWith(TARGET_A, "APPROVE", undefined);

    rerender(screenFor({ onDecide, target: TARGET_B }).element);
    expect(openDialog()).toBeNull();
    expect(approve()).toBeEnabled();
    await act(async () => { finish({ ok: true }); });
    expect(approve()).toBeEnabled();
  });
});

describe("ReviewScreen revision copy matches what each stage does with the note", () => {
  it.each(Object.entries(REVIEW_KINDS) as Array<[ReviewKindKey, (typeof REVIEW_KINDS)[ReviewKindKey]]>)("%s", (kind, review) => {
    renderScreen({ kind });
    fireEvent.click(revise());
    const modal = screen.getByRole("alertdialog");
    expect(modal).toHaveTextContent(/starts another AI generation run that uses paid model calls/i);
    if (review.revisionNoteReachesModel) {
      expect(modal).toHaveTextContent(/your note passed to the AI as its revision instruction/i);
      expect(modal).not.toHaveTextContent(/does not currently pass it to the AI/i);
    } else {
      expect(modal).toHaveTextContent(/does not currently pass it to the AI, so the new version may not reflect it/i);
      expect(modal).not.toHaveTextContent(/as its revision instruction/i);
    }
  });
});

/** Mirrors the workspace: a stale or unconfirmed outcome locks the target, which disables the invokers. */
function LockingScreen({ outcome, onReload }: { outcome: DecisionOutcome; onReload: () => void }) {
  const [locked, setLocked] = useState(false);
  return <ReviewScreen kind="CHANNEL_VIDEO_SCRIPT" target={TARGET_A} versionNumber={2} busy={false} locked={locked} explanation="Approving accepts the script."
    onDecide={async () => { if (!outcome.ok) setLocked(true); return outcome; }} onReload={onReload} />;
}

describe("ReviewScreen focus after a blocked outcome", () => {
  const stale: DecisionOutcome = { ok: false, reason: "stale", message: "Nothing was recorded by this request." };
  const unconfirmed: DecisionOutcome = { ok: false, reason: "unconfirmed", message: "Channelwright couldn't confirm whether this decision was recorded." };

  it.each([["stale", stale], ["unconfirmed", unconfirmed]] as const)("Close after a %s outcome moves focus to the enabled locked-state reload control, not <body>", async (_name, outcome) => {
    render(<LockingScreen outcome={outcome} onReload={vi.fn()} />);
    fireEvent.click(approve());
    fireEvent.click(inDialog(/^approve script v2$/i));
    await screen.findByRole("alert");
    expect(approve()).toBeDisabled();
    fireEvent.click(inDialog(/^close$/i));
    expect(openDialog()).toBeNull();
    const reload = screen.getByRole("button", { name: /reload current state/i });
    expect(reload).toBeEnabled();
    expect(reload).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it("Reload from the dialog moves focus to the review heading and asks for the real state", async () => {
    const onReload = vi.fn();
    render(<LockingScreen outcome={stale} onReload={onReload} />);
    fireEvent.click(reject());
    fireEvent.click(inDialog(/^reject script v2$/i));
    const alert = await screen.findByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: /reload current state/i }));
    expect(onReload).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: /your decision/i })).toHaveFocus();
  });
});
