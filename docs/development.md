# Development

## Requirements

- Node.js compatible with Next.js 16
- npm
- Optional Supabase project for production integration work

## Fixture mode

Copy `.env.example` to `.env.local`. Fixture mode is deterministic, makes no external AI or market-research calls, records zero-dollar costs, and persists local state under `.data/`.

```powershell
Copy-Item .env.example .env.local
npm.cmd install
npm.cmd run dev
```

Use any valid email and a password of six or more characters. Credentials are not stored; the local auth route creates a 12-hour HTTP-only demo cookie derived from the email and signed with `CHANNELWRIGHT_MOCK_SESSION_SECRET` so it cannot be forged or edited to impersonate another fixture user. Set that secret to a stable value of at least 32 characters to keep fixture sessions valid across restarts; otherwise each process signs with an ephemeral secret. Fixture mode is forcibly disabled when `NODE_ENV=production`, even if the mock flag is accidentally left enabled.

## Production configuration

Set:

- `CHANNELWRIGHT_MOCK_MODE=false`
- `NEXT_PUBLIC_CHANNELWRIGHT_MOCK_MODE=false`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` only in trusted server configuration
- `NEXT_PUBLIC_CAPTCHA_PROVIDER=turnstile` or `hcaptcha`, matching Supabase Auth
- `NEXT_PUBLIC_CAPTCHA_SITE_KEY` (public provider site key)

Apply all migrations in order through the shared-project gate. Production media actions plus `CHANNEL_CONCEPT_VALIDATION` and `CHANNEL_RESEARCH` starts are implemented through separate transactional RPCs. Other fixture planning-agent mutations still return capability-specific HTTP 501 responses until explicitly registered and given production adapters. Keep `SUPABASE_SERVICE_ROLE_KEY` only in trusted server and isolated-worker configuration; it must never use a `NEXT_PUBLIC_` name or enter browser code.

Supabase Auth validates the CAPTCHA token received in `options.captchaToken`; Channelwright never accepts a client assertion that verification succeeded. A failed, expired, or rejected token returns to a fresh login page and fresh widget. Automated tests cover token plumbing and widget callbacks, but a human browser completion against the configured production provider remains a manual gate.

The fixed `channelwright-private-media` bucket is created private by migration. Authenticated users can read only database rows and storage objects in their owner namespace. Upload, move, delete, and signed-URL operations are server-mediated.

## Checks

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
$env:CHANNELWRIGHT_MOCK_MODE='true'; npm.cmd run build
npm.cmd run video:render:sample
npm.cmd run video:ffprobe -- renders/deterministic/channelwright-sample.mp4
npm.cmd run video:render:audio
npm.cmd run video:e2e:local
npm.cmd run worker:workflow
```

The tests cover the prior workflow plus media timing, storage integrity/ownership, transactional migration contracts, fixture idempotency conflicts, queue concurrency, lease expiry, bounded retry, worker QA configuration, and exact-version render inputs. Text-level migration tests are not a substitute for applying migrations and exercising RLS against the isolated `channelwright` schema in the shared Supabase project.

## Deterministic local video rendering

The Remotion sample is a silent, locally generated proof that does not call media or AI providers. A second command generates a clearly synthetic WAV test signal and renders audio:

```powershell
npm.cmd run video:studio
npm.cmd run video:render:sample
npm.cmd run video:ffprobe -- renders/deterministic/channelwright-sample.mp4
npm.cmd run video:render:audio
```

Pass extra arguments after `--` to the bundled tools, for example `npm.cmd run video:ffmpeg -- -version`. Render outputs under `renders/` are generated evidence and are ignored by Git.

`video:e2e:local` exercises local content-addressed storage, asset checksum resolution, an in-memory lease, rendering, inspection, technical QA, immutable master storage, and idempotent completion. It remains local-filesystem/in-process evidence. Real operation still requires applied migrations, live Supabase Storage, cross-owner RLS validation, an independently deployed worker, licensed/provider assets, and operational monitoring.

The business-studio, media-pipeline, and production-workflow migrations are forward-only schema artifacts targeting `channelwright`, not `public`. Text-level tests check expected contracts, but live PostgreSQL, RPC-grant, RLS, lease, and cross-tenant evidence remains separate until the shared-project gate runs.
