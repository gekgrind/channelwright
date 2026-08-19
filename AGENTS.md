# AGENTS.md

## Channelwright Product Doctrine

Before planning or implementing substantial Channelwright functionality, read:

`docs/PRODUCT_DOCTRINE.md`

Treat that document as a binding product constraint.

Core positioning:

- Channelwright is **not** "AI YouTube Automation."
- Channelwright is **the AI operating system for building and running a profitable YouTube media business.**
- Channelwright should **manage the business, not merely automate the content factory.**

## Required Product Check

For each substantial feature or architectural change:

1. Identify which part of the Channelwright business loop it strengthens:
   `Opportunity → Validation → Strategy → Production → Distribution → Measurement → Learning → Monetization → Next Decision`
2. Prefer evidence-backed strategy over generic AI-generated recommendations.
3. Preserve viewer value, originality, business viability, strategic learning, and durable decision history where relevant.
4. Do not optimize primarily for publishing volume or generic content automation.
5. Redesign or reject approaches that move Channelwright toward a faceless-channel content factory, generic SEO tool, upload scheduler, or disconnected collection of AI generators.
6. If a requested implementation conflicts with `docs/PRODUCT_DOCTRINE.md`, stop and surface the conflict before implementing it.

## Implementation Discipline

- Keep changes scoped to the requested slice.
- Inspect existing architecture before introducing new abstractions.
- Reuse existing durable workflow, QA, approval, accounting, security, and persistence patterns rather than creating parallel systems.
- Preserve backward compatibility unless the task explicitly requires a breaking change.
- Do not weaken authentication, authorization, ownership isolation, RLS, usage accounting, provenance, approval gates, or failure recovery for convenience.
- Add or update tests for material behavior changes.
- Do not push, deploy, apply database migrations, or mutate production services unless explicitly instructed.

## Verification

Before declaring implementation complete, run the relevant available checks, normally:

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

Report failures accurately. Do not hide skipped verification.

## Output Style

Keep completion reports concise and decision-oriented:

- what changed
- why it supports the Product Doctrine
- tests/verification performed
- remaining risks or follow-up work
