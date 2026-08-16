import { describe, expect, it, vi } from "vitest";
import { errorMessage, logFailure } from "./observability";

describe("observability", () => {
  it("extracts a message from errors and message carriers without losing unknown failures", () => {
    expect(errorMessage(new Error("socket hang up"))).toBe("socket hang up");
    expect(errorMessage({ message: "PGRST301" })).toBe("PGRST301");
    expect(errorMessage("not an error")).toBe("unknown");
  });

  it("emits a structured failure record on stderr", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logFailure("render_worker_iteration_failed", new Error("lease lost"), { workerId: "worker-a" });
    const [record] = consoleError.mock.calls[0] as [string];
    expect(JSON.parse(record)).toMatchObject({ event: "render_worker_iteration_failed", message: "lease lost", workerId: "worker-a" });
    consoleError.mockRestore();
  });
});
