import { describe, expect, it } from "vitest";
import { signMockSession, verifyMockSession } from "./mock-session";

const payload = { id: "a".repeat(24), email: "operator@example.com" };

describe("fixture session cookies", () => {
  it("round-trips a signed session", () => {
    expect(verifyMockSession(signMockSession(payload))).toEqual(payload);
  });

  it("rejects unsigned, tampered, and malformed cookies", () => {
    const unsigned = Buffer.from(JSON.stringify({ id: "b".repeat(24), email: "attacker@example.com" })).toString("base64url");
    const signed = signMockSession(payload);
    const [body, signature] = signed.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ id: "b".repeat(24), email: "attacker@example.com" })).toString("base64url");
    expect(verifyMockSession(unsigned)).toBeNull();
    expect(verifyMockSession(`${forgedBody}.${signature}`)).toBeNull();
    expect(verifyMockSession(`${body}.`)).toBeNull();
    expect(verifyMockSession(undefined)).toBeNull();
  });

  it("rejects signed payloads that violate the session shape", () => {
    expect(() => signMockSession({ id: "../../etc/passwd", email: "operator@example.com" })).toThrow();
    expect(() => signMockSession({ id: "a".repeat(24), email: "not-an-email" })).toThrow();
  });
});
