import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const MOCK_SESSION_COOKIE = "cw_mock_user";

const payloadSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/),
  email: z.string().email().max(320),
}).strict();

export type MockSessionPayload = z.infer<typeof payloadSchema>;

const ephemeralSecret = randomBytes(32).toString("hex");

function secret() {
  const configured = process.env.CHANNELWRIGHT_MOCK_SESSION_SECRET?.trim();
  return configured && configured.length >= 32 ? configured : ephemeralSecret;
}

const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

export function signMockSession(payload: MockSessionPayload) {
  const body = Buffer.from(JSON.stringify(payloadSchema.parse(payload))).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyMockSession(value: string | undefined): MockSessionPayload | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const body = value.slice(0, separator);
  const provided = Buffer.from(value.slice(separator + 1), "base64url");
  const expected = Buffer.from(sign(body), "base64url");
  if (provided.byteLength !== expected.byteLength || !timingSafeEqual(provided, expected)) return null;
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
