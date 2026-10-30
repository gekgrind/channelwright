import { describe, expect, it } from "vitest";
import { sameOriginRedirect } from "./same-origin-redirect";

describe("same-origin redirect", () => {
  it.each(["/login", "/studio", "/login?error=auth"] as const)("emits a relative 303 to %s", (path) => {
    const response = sameOriginRedirect(path);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(path);
    for (const origin of ["https://channelwright.entrepreneuria.io", "http://localhost:3005"]) {
      expect(new URL(response.headers.get("location")!, `${origin}/api/auth/logout`).origin).toBe(origin);
    }
  });

  it.each(["//evil.example/login", "/\\evil.example", "https://evil.example/login", "login", "", "/\t/evil.example", "/\t\\evil.example", "/\n/evil.example", "/\r/evil.example", "/login\u0000"])("rejects %j, which could leave the origin", (path) => {
    expect(() => sameOriginRedirect(path as `/${string}`)).toThrow();
  });
});
