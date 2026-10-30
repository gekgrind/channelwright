"use client";

import Link from "next/link";
import { useState } from "react";
import { ReviewScreen } from "./review-screen";
import { REVIEW_KINDS, reviewVersionLabel } from "./review-kinds";
import { PREVIEW_KINDS, PREVIEW_OUTCOMES, type PreviewKind, type PreviewOutcome } from "./review-preview-fixtures";
import { WorkspaceFeedback } from "./workflow-controls";
import type { DecisionOutcome, DecisionTarget } from "./workflow-api";

const FIXTURE_DELAY_MS = 700;

/**
 * Fixture harness for the shared ReviewScreen. It sends nothing to any API:
 * decisions resolve locally with the selected simulated outcome.
 */
export function ReviewPreview({ kind, outcome }: { kind: PreviewKind; outcome: PreviewOutcome }) {
  const review = REVIEW_KINDS[PREVIEW_KINDS[kind]];
  const [attempt, setAttempt] = useState(1);
  const [decided, setDecided] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [noticeFocusKey, setNoticeFocusKey] = useState(0);
  const target: DecisionTarget = { workflowId: `fixture-${kind}`, runId: `fixture-run-${attempt}`, approvalId: `fixture-approval-${attempt}`, key: `fixture-${kind}:${attempt}` };
  const label = reviewVersionLabel(review, 2);

  const decide = async (_target: DecisionTarget, decision: string): Promise<DecisionOutcome> => {
    await new Promise((resolve) => setTimeout(resolve, FIXTURE_DELAY_MS));
    const result = PREVIEW_OUTCOMES[outcome];
    if (result.ok) {
      setDecided(`${decision.replaceAll("_", " ")} recorded on ${label} (fixture: nothing was sent).`);
      setNoticeFocusKey((value) => value + 1);
    } else if (result.reason !== "unauthorized") setLocked(true);
    return result;
  };

  const reset = () => { setDecided(null); setLocked(false); setAttempt((value) => value + 1); };

  return (
    <main id="main" className="review-preview">
      <header className="review-preview-head">
        <p className="eyebrow">Fixture preview · demonstration data, nothing is sent</p>
        <h1>{review.versionNoun} review</h1>
        <nav aria-label="Review kind">
          <ul>{(Object.keys(PREVIEW_KINDS) as PreviewKind[]).map((key) => <li key={key}><Link href={`/studio/preview/review?kind=${key}&outcome=${outcome}`} aria-current={key === kind ? "page" : undefined}>{REVIEW_KINDS[PREVIEW_KINDS[key]].versionNoun}</Link></li>)}</ul>
        </nav>
        <nav aria-label="Simulated outcome">
          <ul>{(Object.keys(PREVIEW_OUTCOMES) as PreviewOutcome[]).map((key) => <li key={key}><Link href={`/studio/preview/review?kind=${kind}&outcome=${key}`} aria-current={key === outcome ? "page" : undefined}>{key}</Link></li>)}</ul>
        </nav>
      </header>
      <WorkspaceFeedback label={review.noun} loading={false} busy={false} error={null} refreshError={null} notice={decided} polling={false} onRetry={reset} noticeFocusKey={noticeFocusKey} />
      <article className="brief-document">
        <header><h2>{label}</h2><p className="muted">Fixture artifact. The {review.noun} itself renders here on its stage screen.</p></header>
      </article>
      {decided
        ? <button type="button" className="button" onClick={reset}>Reset fixture</button>
        : <ReviewScreen kind={PREVIEW_KINDS[kind]} target={target} versionNumber={2} busy={false} locked={locked}
            title={`Review ${label}`} explanation={review.approves} revisionPlaceholder={`What should the revised ${review.noun} change?`}
            onDecide={decide} onReload={reset} />}
    </main>
  );
}
