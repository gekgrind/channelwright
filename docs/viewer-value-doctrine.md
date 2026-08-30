# Channelwright Viewer Value Doctrine

Channelwright exists to build sustainable YouTube businesses by creating content worth watching. It does not exist to maximise automated content volume. Everything the platform recommends, plans, scripts, produces, packages, or publishes must deliver identifiable value to an intended viewer.

This is a product invariant, not a platform-policy checkbox. Policy wording changes; the obligation to be worth someone's time does not.

## What the doctrine asserts

- **AI assistance is not itself a quality failure.** Channelwright judges the result, not the tool. A rigorous, original, well-evidenced video assembled with AI passes. A template-filled video assembled by hand does not.
- **Originality, usefulness, truthfulness, differentiation, and viewer value are mandatory**, not scoring bonuses. They gate what is allowed to proceed.
- **Every stage can be checked for value drift.** A topic that promised useful analysis must not become generic filler by the time it is a script.
- **Packaging cannot overpromise the underlying content.** A future packaging stage inherits the same contract and may not make a claim the content cannot fulfil.
- **Quantity never overrides quality gates.** A smaller backlog of defensible ideas is the correct output; there is no throughput target that can override a gate.

## The contract

`src/domain/viewer-value.ts` is deliberately stage-agnostic. It defines:

- `viewerValueContract` — intended viewer; viewer need with kind and urgency; value promise with one or more value kinds and a concrete viewer outcome; original contribution with named contribution kinds; and judged dimensions for specificity, originality, differentiation, evidence support, actionability, trustworthiness, and sustainability.
- `viewerValueAssessment` — the contract plus strengths, weaknesses, assumptions, uncertainties, improvement suggestions, content-integrity findings, policy signals, a `PASS | REVISE | REJECT` gate, and the reasons for that gate.
- `viewerValueProvenance` — origin stage, workflow type, run, subject, a canonical SHA-256 `contractHash`, gate, and timestamp.

Taxonomies are extensible: each carries an `OTHER` member with a label, so a new kind of value never invalidates a persisted artifact. No list in the module claims to be exhaustive.

There is no bare `viewerValueScore: 87`. Every judgement is a verdict plus a rationale plus its evidence references.

## The gate

`deterministicViewerValueGate` establishes a floor the model cannot argue below, and `resolveViewerValueGate` always takes the stricter of the deterministic floor and the model's own claim.

**REJECT** — any blocking content-integrity finding, or trustworthiness that is weak or absent. Concepts whose core appeal depends on fabricated events, misleading claims, unsupported factual or monetary promises, fake urgency, fake authority, invented statistics or demographics, or mass-produced template filler with no substantive differentiation.

**REVISE** — real potential, but currently insufficient specificity, originality, differentiation, evidence support, or channel sustainability; or a material (non-blocking) integrity risk; or `not_applicable` claimed on a dimension that always applies.

**PASS** — a clear audience need, a specific proposed value, plausible differentiation, and no material trust concern.

`actionability` may legitimately be `not_applicable`: value is format-sensitive, and a narrative documentary is not less valuable because it lacks a checklist. Differentiation, evidence support, trustworthiness, and sustainability may never be waived.

## Transitivity

The intended chain is:

```
CHANNEL_RESEARCH      is this channel opportunity real?
CHANNEL_STRATEGY      how should this channel compete?
CONTENT_INTELLIGENCE  what should it make next, and why?          <- first Viewer Value assessment
CHANNEL_VIDEO_BRIEF   what should this specific video accomplish?  <- second Viewer Value assessment
CHANNEL_VIDEO_SCRIPT  write the timed script for that video        <- third Viewer Value assessment
PACKAGING             title, thumbnail, description                (future)
PRODUCTION            create the media                             (future)
PUBLISHING            release it                                   (future)
```

`CONTENT_INTELLIGENCE` produces the first `viewerValueAssessment` per topic, `CHANNEL_VIDEO_BRIEF` produces the second against the selected topic, and `CHANNEL_VIDEO_SCRIPT` produces the third against the timed script. Each later stage is expected to carry `viewerValueProvenance` referencing the originating `contractHash` and to re-run the same standard against its own artifact. Because the hash is canonical and key-order independent, a downstream stage that quietly changes the promise no longer matches its source, which is what makes value drift detectable rather than assumed away.

`CHANNEL_VIDEO_BRIEF` and `CHANNEL_VIDEO_SCRIPT` are implemented and inherit the contract unchanged: each carries the originating `contractHash` as immutable `inheritedViewerValueProvenance` and re-runs the same standard against its own artifact, with the script's deterministic Viewer Value floor overruling an optimistic model gate. Nothing downstream of the script (packaging, production, publishing) is implemented yet. The contract is deliberately shaped so those stages can inherit it without replacing today's schema.

## Content integrity and policy signals

`contentIntegrityFinding` records unsupported income claims, guaranteed outcomes, fabricated events, statistics, testimonials, search volume, demographics or performance predictions, misleading packaging, false authority, health-outcome claims, false urgency, and inauthentic mass production. Severity is `blocking`, `material`, or `advisory`; blocking fails closed.

Channelwright may teach legitimate ways to build a business or earn money. It must not convert uncertainty into a promise to increase clicks. Fact, evidence-backed inference, hypothesis, estimate, opinion, and recommendation stay distinguishable throughout the contracts.

`policySignal` is a deliberately generic compliance layer with categories for originality, misleading metadata, synthetic-media disclosure, advertiser friendliness, community guidelines, and other. Content intelligence emits structured signals; later production and publishing stages consume them. Transient platform-policy wording is not embedded in business logic, and AI-generated content is never blocked merely for being AI-generated.

Provider metadata, competitor content, and model output are untrusted input at every stage.
