// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StageList, WorkspaceFeedback } from "./workflow-controls";

afterEach(cleanup);

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

describe("WorkspaceFeedback", () => {
  const feedback = (noticeFocusKey: number, notice: string | null) => <WorkspaceFeedback label="script" loading={false} busy={false} error={null} refreshError={null} notice={notice} polling={false} onRetry={() => undefined} noticeFocusKey={noticeFocusKey} />;

  it("moves focus to the decision notice on each decision outcome, so focus survives the review screen unmounting", () => {
    const { rerender } = render(feedback(0, "Started."));
    expect(screen.getByRole("status")).not.toHaveFocus();
    rerender(feedback(1, "APPROVE recorded."));
    expect(screen.getByRole("status")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("APPROVE recorded.");
  });
});
