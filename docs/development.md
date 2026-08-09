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

Use any valid email and a password of six or more characters. Credentials are not stored; the local auth route creates a 12-hour HTTP-only demo cookie derived from the email. Fixture mode is forcibly disabled when `NODE_ENV=production`, even if the mock flag is accidentally left enabled.

## Production configuration

Set:

- `CHANNELWRIGHT_MOCK_MODE=false`
- `NEXT_PUBLIC_CHANNELWRIGHT_MOCK_MODE=false`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` only in trusted server configuration

Apply the migration through the Supabase CLI or dashboard. The current slice includes Supabase authentication and schema/RLS, but intentionally returns HTTP 501 for production workflow mutations until a transactional Supabase repository and live provider adapters are implemented. Do not expose the service-role key to the browser.

## Checks

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
$env:CHANNELWRIGHT_MOCK_MODE='true'; npm.cmd run build
```

The tests cover schema-shaped agent outputs, legal and illegal state transitions, GO advancement, CAUTION/STOP pauses, overrides, concept revision/versioning, discovery, owner-scoped idempotency and activity history, video orchestration, script revision, and approval.
