# Channelwright

Channelwright is a deterministic, state-driven content studio for evidence-led YouTube channels. It validates structured agent outputs, preserves concept and script history, pauses at human decision gates, and records workflow activity instead of running an opaque autonomous swarm.

This repository contains the first vertical slice:

- Mock or Supabase-backed authentication boundary
- User-defined and agent-discovered channel concept paths
- Five-gate concept viability reports with GO, CAUTION, and STOP_RECOMMENDED
- Override, revision, alternative discovery, and candidate selection
- Persisted channel strategy contract
- Video strategy, fixture research, versioned script, separate QA, and script approval
- Required YouTube plus optional TikTok and Instagram/Facebook Reels distribution defaults, frozen per video
- Deterministic, versioned TikTok and Reels adaptation plans with platform QA and exact-version human approval
- PostgreSQL schema and deny-by-default RLS policies
- Deterministic fixture mode for local evaluation without provider credentials

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

Read [docs/development.md](docs/development.md) for environment setup and [docs/architecture.md](docs/architecture.md) for system boundaries.

## Distribution boundary

YouTube is always the canonical target. A channel may also request TikTok and/or a shared Instagram/Facebook Reels adaptation. New videos snapshot those defaults so later channel changes cannot alter existing production scope.

This vertical slice still ends at approved scripts. After script approval, selected fixture agents create distinct short-form **adaptation plans**, run provider-independent QA, and pause for plan approval. They do not render video, inspect media, upload files, authenticate social accounts, or publish posts. Every plan therefore retains explicit master-render, media-validation, storage, OAuth, and publishing blockers. See [docs/platform-requirements.md](docs/platform-requirements.md) for the configurable planning constraints and official sources checked on 2026-08-09.
