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

Read [docs/development.md](docs/development.md) for environment setup, [docs/architecture.md](docs/architecture.md) for system boundaries, [docs/reference-channel-workflow.md](docs/reference-channel-workflow.md) for reference research and originality rules, and [docs/monetization-conversation.md](docs/monetization-conversation.md) for the monetization and conversational revision boundary.

## Distribution boundary

YouTube is always the canonical target. A channel may also request TikTok and/or a shared Instagram/Facebook Reels adaptation. New videos snapshot those defaults so later channel changes cannot alter existing production scope.

The video path still ends at approved scripts and short-form **adaptation plans**. The business-studio paths produce specifications, previews, manifests, fixture consent/delivery records, and fixture commerce records; they do not execute generated projects, deploy pages, send email, charge money, retrieve private analytics, render video, inspect media, upload files, authenticate social accounts, or publish posts. Those capabilities remain explicit provider, credential, security-validation, and production-persistence blockers. See [docs/platform-requirements.md](docs/platform-requirements.md) for the configurable planning constraints and official sources checked on 2026-08-09.
