import type { ClaimedWorkflowStep } from "@/domain/production-workflows";

export function requirePriorOutput<T>(step: ClaimedWorkflowStep, key: string, parse: (value: unknown) => T, missing: (key: string) => Error): T {
  const value = step.priorOutputs[key];
  if (!value) throw missing(key);
  return parse(value);
}

export function logWorkflowStage(event: string, step: ClaimedWorkflowStep, detail: Record<string, unknown>) {
  console.info(event, { workflowId: step.workflowId, runId: step.runId, ownerId: step.ownerId, stage: step.stepKey, attempt: step.attemptCount, ...detail });
}

type SeverityFinding = { severity: string; code: string; evidenceIds: string[] };

export function findingFingerprint(finding: SeverityFinding) {
  return `${finding.code}:${[...finding.evidenceIds].sort().join(",")}`;
}

export function newlyIntroducedErrors<T extends SeverityFinding>(before: T[], after: T[]): T[] {
  const existing = new Set(before.filter((finding) => finding.severity === "error").map(findingFingerprint));
  return after.filter((finding) => finding.severity === "error" && !existing.has(findingFingerprint(finding)));
}
