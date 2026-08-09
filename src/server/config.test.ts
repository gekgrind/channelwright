import { afterEach, describe, expect, it, vi } from "vitest";
import { isMockMode } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fixture-mode boundary", () => {
  it("allows explicit fixture mode outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
    expect(isMockMode()).toBe(true);
  });

  it("cannot enable fixture authentication in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
    expect(isMockMode()).toBe(false);
  });
});
