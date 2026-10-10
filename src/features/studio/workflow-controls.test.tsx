// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DecisionBar, StageList } from "./workflow-controls";

afterEach(cleanup);

function renderBar(onDecide = vi.fn(async () => true)) {
  render(<DecisionBar
    busy={false}
    explanation="Approving accepts the script."
    versionLabel="Script v2"
    approveLabel="Approve exact version"
    revisionPlaceholder="What should change?"
    artifactLabel="script"
    onDecide={onDecide}
  />);
  return onDecide;
}

describe("DecisionBar", () => {
  it("approves in one click and names the exact version the approval binds to", async () => {
    const onDecide = renderBar();
    expect(screen.getByText(/approval binds to/i)).toHaveTextContent("Script v2");
    fireEvent.click(screen.getByRole("button", { name: /approve exact version/i }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith("APPROVE", undefined));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps Request revision disabled until a meaningful note exists", async () => {
    const onDecide = renderBar();
    const revise = screen.getByRole("button", { name: /request revision/i });
    expect(revise).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/revision note/i), { target: { value: "   " } });
    expect(revise).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/revision note/i), { target: { value: "Cut the second example." } });
    fireEvent.click(revise);
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith("REQUEST_REVISION", "Cut the second example."));
  });

  it("does not reject on the first click; it explains the terminal consequence first", () => {
    const onDecide = renderBar();
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onDecide).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog", { name: /reject and close this script/i });
    expect(dialog).toHaveTextContent(/stays in the ledger as rejected/i);
    expect(dialog).toHaveTextContent(/can no longer be approved or revised/i);
    // The least destructive choice receives focus.
    expect(screen.getByRole("button", { name: /keep reviewing/i })).toHaveFocus();
  });

  it("cancelling the confirmation sends nothing and returns focus to Reject", () => {
    const onDecide = renderBar();
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    fireEvent.click(screen.getByRole("button", { name: /keep reviewing/i }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /reject/i })).toHaveFocus();
  });

  it("Escape also cancels the confirmation without rejecting", () => {
    const onDecide = renderBar();
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("confirming sends exactly one Reject, with the optional reason when given", async () => {
    let resolve: (value: boolean) => void = () => undefined;
    const onDecide = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    renderBar(onDecide);
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Wrong audience entirely." } });
    const confirm = screen.getByRole("button", { name: /reject and close/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith("REJECT", "Wrong audience entirely.");
    resolve(true);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("omits an empty rejection reason rather than sending a blank note", async () => {
    const onDecide = renderBar();
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    fireEvent.click(screen.getByRole("button", { name: /reject and close/i }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith("REJECT", undefined));
  });

  it("styles destructive actions distinctly from revision", () => {
    renderBar();
    const reject = screen.getByRole("button", { name: /reject/i });
    const revise = screen.getByRole("button", { name: /request revision/i });
    expect(reject).toHaveClass("button-danger");
    expect(revise).not.toHaveClass("button-danger");
    fireEvent.click(reject);
    expect(screen.getByRole("button", { name: /reject and close/i })).toHaveClass("button-danger-solid");
  });
});

describe("StageList", () => {
  it("gives failed and completed steps distinct state classes and readable text", () => {
    render(<StageList steps={[
      { id: "1", step_key: "final-video-script-qa", status: "COMPLETED", attempt_count: 1, max_attempts: 2, error_code: null },
      { id: "2", step_key: "finalize-video-script", status: "FAILED", attempt_count: 2, max_attempts: 2, error_code: "SCRIPT_QA_FAILED" },
    ]} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveClass("stage-completed");
    expect(items[1]).toHaveClass("stage-failed");
    expect(items[1]).toHaveTextContent(/FAILED · attempt 2\/2/);
    expect(items[1]).toHaveTextContent("SCRIPT_QA_FAILED");
  });
});
