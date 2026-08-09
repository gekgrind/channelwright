import { describe, expect, it } from "vitest";
import { IllegalTransitionError, transitionChannel, transitionVideo } from "./state-machines";

describe("channel state machine", () => {
  it("supports the user-defined path", () => {
    expect(transitionChannel("DRAFT", "CONCEPT_RESEARCH_PENDING")).toBe("CONCEPT_RESEARCH_PENDING");
    expect(transitionChannel("CONCEPT_RESEARCH_PENDING", "CONCEPT_REVIEW_REQUIRED")).toBe("CONCEPT_REVIEW_REQUIRED");
    expect(transitionChannel("CONCEPT_REVIEW_REQUIRED", "CONCEPT_ACCEPTED")).toBe("CONCEPT_ACCEPTED");
  });

  it("supports discovery and rejects illegal skips", () => {
    expect(transitionChannel("DRAFT", "CONCEPT_DISCOVERY_PENDING")).toBe("CONCEPT_DISCOVERY_PENDING");
    expect(() => transitionChannel("DRAFT", "READY_FOR_VIDEO_PRODUCTION")).toThrow(IllegalTransitionError);
  });
});

describe("video state machine", () => {
  it("reaches human review and supports revision", () => {
    expect(transitionVideo("SCRIPT_QA_PENDING", "SCRIPT_REVIEW_REQUIRED")).toBe("SCRIPT_REVIEW_REQUIRED");
    expect(transitionVideo("SCRIPT_REVIEW_REQUIRED", "SCRIPT_PENDING")).toBe("SCRIPT_PENDING");
  });

  it("does not permit approval before review", () => {
    expect(() => transitionVideo("DRAFT", "SCRIPT_APPROVED")).toThrow("Illegal video transition");
  });
});
