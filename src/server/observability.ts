interface MessageCarrier { message: string }

const hasMessage = (value: unknown): value is MessageCarrier =>
  typeof value === "object" && value !== null && "message" in value && typeof (value as MessageCarrier).message === "string";

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : hasMessage(error) ? error.message : "unknown";

export function logEvent(event: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...detail }));
}

export function logFailure(event: string, error: unknown, detail: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ at: new Date().toISOString(), event, message: errorMessage(error), ...detail }));
}
