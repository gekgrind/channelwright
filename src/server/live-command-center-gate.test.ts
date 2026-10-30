import { afterEach, describe, expect, it, vi } from "vitest";
import { isLiveCommandCenterOn, isLiveCommandCenterUser } from "./config";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

afterEach(() => vi.unstubAllEnvs());

describe("live Command Center gate, step one: the flag", () => {
  it.each([
    ["on", "production", true],
    [undefined, "production", false],
    ["ON", "production", false],
    ["true", "production", false],
    [" on", "production", false],
  ])("CHANNELWRIGHT_LIVE_COMMAND_CENTER=%s in %s → %s", (flag, nodeEnv, expected) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "false");
    if (flag === undefined) vi.stubEnv("CHANNELWRIGHT_LIVE_COMMAND_CENTER", undefined as unknown as string);
    else vi.stubEnv("CHANNELWRIGHT_LIVE_COMMAND_CENTER", flag);
    expect(isLiveCommandCenterOn()).toBe(expected);
  });

  it("is always off in fixture mode, even with the flag on", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CHANNELWRIGHT_MOCK_MODE", "true");
    vi.stubEnv("CHANNELWRIGHT_LIVE_COMMAND_CENTER", "on");
    expect(isLiveCommandCenterOn()).toBe(false);
  });
});

describe("live Command Center gate, step two: the allowlist", () => {
  it.each([
    ["unset admits every signed-in user", undefined, OTHER, true],
    ["set but empty admits nobody", "", OWNER, false],
    ["whitespace only admits nobody", "   ", OWNER, false],
    ["a listed user is admitted, trimmed and case-insensitive", ` ${OWNER.toUpperCase()} , ${OTHER}`, OWNER, true],
    ["an unlisted user is refused", OWNER, OTHER, false],
    ["one malformed entry invalidates the whole list", `${OWNER},not-a-uuid`, OWNER, false],
    ["a trailing comma is a malformed (empty) entry", `${OWNER},`, OWNER, false],
  ])("%s", (_label, raw, userId, expected) => {
    if (raw === undefined) vi.stubEnv("CHANNELWRIGHT_LIVE_COMMAND_CENTER_USERS", undefined as unknown as string);
    else vi.stubEnv("CHANNELWRIGHT_LIVE_COMMAND_CENTER_USERS", raw);
    expect(isLiveCommandCenterUser(userId)).toBe(expected);
  });
});
