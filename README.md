# Channelwright

Channelwright is a deterministic, state-driven content studio for evidence-led YouTube channels. It validates structured agent outputs, preserves concept and script history, pauses at human decision gates, and records workflow activity instead of running an opaque autonomous swarm.

This repository contains a fixture-backed business-studio vertical slice:

- Mock or Supabase-backed authentication boundary
- User-defined and agent-discovered channel concept paths
- Reference-channel onboarding with safe YouTube URL canonicalization, immutable fixture reports, and exact-version approval
- Versioned three-fundamentals strategies connecting a Pillar Video, valuable free resource, paid product, and broader monetization options
- Constrained, versioned resource/funnel fixture artifacts with manifest QA, consent/delivery records, and explicit deployment blockers
- Provider-neutral paid-product commerce fixtures where verified server-side events—not redirects—control idempotent entitlements and refunds
- Five-gate concept viability reports with GO, CAUTION, and STOP_RECOMMENDED
- Override, revision, alternative discovery, and candidate selection
- Persisted channel strategy contract
- Video strategy, fixture research, versioned script, separate QA, and script approval
- Required YouTube plus optional TikTok and Instagram/Facebook Reels distribution defaults, frozen per video
- Deterministic, versioned TikTok and Reels adaptation plans with platform QA and exact-version human approval
- PostgreSQL schema and deny-by-default RLS policies
- Deterministic fixture mode for local evaluation without provider credentials
- A deterministic Remotion composition with silent and generated-test-audio local render paths
- A transactional Supabase media-production schema with exact-version inputs, durable jobs, leases, attempts, inspections, QA, and production masters
- A transactional strategic workflow engine with typed definitions, durable runs/steps/attempts, leases, bounded retries, approvals, cancellation, and structured events
- CAPTCHA-aware Supabase password login supporting the configured Turnstile or hCaptcha provider without exposing provider or service secrets
- Provider-neutral private object storage with content-addressed owner namespaces and a deterministic local adapter
- Versioned monetization plans covering thirteen revenue streams, with facts separated from assumptions and exact-version approval
- A three-pane conversational studio where typed change requests create new immutable artifact versions

## Start locally

```powershell
Copy-Item .env.example .env.local
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000`. In fixture mode, any valid email and password of at least six characters creates a local demo session. Fixture records persist in `.data/mock-workspace.json` and are intentionally excluded from Git.

## Verification

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Read [docs/development.md](docs/development.md) for environment setup, [docs/architecture.md](docs/architecture.md) for system boundaries, [docs/workflow-engine.md](docs/workflow-engine.md) for the production orchestration contract, [docs/reference-channel-workflow.md](docs/reference-channel-workflow.md) for reference research and originality rules, and [docs/monetization-conversation.md](docs/monetization-conversation.md) for the monetization and conversational revision boundary.

## Distribution boundary

YouTube is always the canonical target. A channel may also request TikTok and/or a shared Instagram/Facebook Reels adaptation. New videos snapshot those defaults so later channel changes cannot alter existing production scope.

Approved scripts can now create immutable render-input versions and durable render jobs. An isolated worker contract downloads checksum-verified private assets, renders outside Next.js request handling, inspects the actual MP4, uploads an immutable master, and atomically records separated QA state. This is implemented and locally testable; it is not evidence that the migration has been applied, Supabase Storage has been exercised, or a worker has been independently deployed. Existing TikTok/Reels records remain **ADAPTATION_PLAN** records and never inherit readiness from a YouTube master.

Live image, footage, narration, and music providers are still undecided. OAuth, platform uploads, publishing, and post-publish verification are not implemented. See [docs/video-workflow.md](docs/video-workflow.md) for evidence levels and [docs/operations.md](docs/operations.md) for worker/storage operations and remaining live gates.

`CHANNEL_CONCEPT_VALIDATION` v1 deliberately returns `RESEARCH_REQUIRED`; it remains provider-neutral orchestration proof. The separate `CHANNEL_RESEARCH` v1 workflow retrieves current public YouTube evidence through the official Data API, preserves provenance and resource usage, produces strict structured analysis, runs independent QA plus one bounded revision, and waits for exact-run human review. It still requires configured providers, an independently supervised trusted worker, the research migration, and live environment validation before it can be called deployed or production-ready.
