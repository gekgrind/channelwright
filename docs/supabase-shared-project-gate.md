# Shared Supabase project gate

Channelwright can safely use the existing Supabase project without a second paid project. Its relational objects live in the dedicated `channelwright` PostgreSQL schema, its migration ledger lives in the unexposed `channelwright_migrations` schema, and media lives in the uniquely named private `channelwright-private-media` bucket.

This is an isolated-schema gate, not an empty-project gate. It does not claim that the shared database, auth system, or Storage service is empty.

## Verified collision boundary

The read-only Data API preflight for project `rifzbzaabkaeagyulxip` found existing Architecta and other application tables in `public`, including an unrelated `public.entitlements` table. Channelwright migrations must never be applied to `public`. No Channelwright tables were exposed through the Data API, and the `channelwright-private-media` bucket was absent. Because an unexposed PostgreSQL schema is invisible to the Data API, the database-connection preflight must still prove the `channelwright` and `channelwright_migrations` schemas are unused before any mutation.

The migration runner refuses first-time mutation unless all three Channelwright-owned targets are unused:

- no `channelwright` schema;
- no `channelwright_migrations.schema_migrations` ledger;
- no `channelwright-private-media` bucket.

On a resumable run, every recorded migration name and checksum must match the repository exactly.

## Required local values

Use the existing project's API URL, anon key, service-role key, and PostgreSQL connection URI. Never paste credentials into chat or use a `NEXT_PUBLIC_` name for the service-role key.

The existing API values can be loaded from `.env.local` into the current PowerShell process without printing them:

```powershell
$channelwrightEnvValues = @{}
Get-Content -LiteralPath '.env.local' | ForEach-Object {
  $line = $_.Trim()
  if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    $channelwrightEnvValues[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
  }
}
$env:CHANNELWRIGHT_SHARED_SUPABASE_URL=$channelwrightEnvValues['NEXT_PUBLIC_SUPABASE_URL']
$env:CHANNELWRIGHT_SHARED_SUPABASE_ANON_KEY=$channelwrightEnvValues['NEXT_PUBLIC_SUPABASE_ANON_KEY']
$env:CHANNELWRIGHT_SHARED_SUPABASE_SERVICE_ROLE_KEY=$channelwrightEnvValues['SUPABASE_SERVICE_ROLE_KEY']
```

Then set only the database URI and explicit safety confirmations:

```powershell
$env:CHANNELWRIGHT_SHARED_DATABASE_URL='YOUR_EXISTING_PROJECT_POSTGRES_URI'
$env:CHANNELWRIGHT_SHARED_PROJECT_REF='rifzbzaabkaeagyulxip'
$env:CHANNELWRIGHT_SHARED_CONFIRM_PROJECT_REF='rifzbzaabkaeagyulxip'
$env:CHANNELWRIGHT_SHARED_CONFIRM_SCHEMA='channelwright'
$env:CHANNELWRIGHT_GATE_SAMPLE_VIDEO_PATH='C:\DevProjects\channelwright\renders\deterministic\channelwright-sample.mp4'
```

Obtain the PostgreSQL URI from the existing project's database connection panel. Prefer the session-pooler URI if direct IPv6 connectivity is unavailable. The URI's hostname or username must contain the project ref or the gate rejects it.

Verify presence without printing values:

```powershell
@(
  'CHANNELWRIGHT_SHARED_SUPABASE_URL',
  'CHANNELWRIGHT_SHARED_SUPABASE_ANON_KEY',
  'CHANNELWRIGHT_SHARED_SUPABASE_SERVICE_ROLE_KEY',
  'CHANNELWRIGHT_SHARED_DATABASE_URL',
  'CHANNELWRIGHT_SHARED_PROJECT_REF',
  'CHANNELWRIGHT_SHARED_CONFIRM_PROJECT_REF',
  'CHANNELWRIGHT_SHARED_CONFIRM_SCHEMA'
) | ForEach-Object {
  '{0}={1}' -f $_, $(if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_))) { 'MISSING' } else { 'SET' })
}
```

Every line must end in `=SET`.

## Exact migration impact

`npm.cmd run gate:supabase:migrate` creates only:

- schemas `channelwright` and `channelwright_migrations`;
- Channelwright tables, types, functions, triggers, indexes, constraints, grants, and RLS policies inside `channelwright`;
- the private `channelwright-private-media` bucket and its owner-read policy;
- the checksum migration ledger.

It does not drop, truncate, rename, update, or grant access to existing `public` tables or existing Storage buckets.

## Sequential gate

From `C:\DevProjects\channelwright`, generate the real harmless MP4 if needed:

```powershell
npm.cmd run video:render:sample
Test-Path -LiteralPath $env:CHANNELWRIGHT_GATE_SAMPLE_VIDEO_PATH
```

Expected verification: `True`.

Apply the migrations and direct catalog checks:

```powershell
npm.cmd run gate:supabase:migrate
```

Expected verdict: `SHARED_SCHEMA_MIGRATION_CATALOG_PASSED`, with `failed: 0` and `skipped: 0`.

In the Supabase dashboard, add `channelwright` to the project's exposed Data API schemas. Do not expose `channelwright_migrations`. This is required because the application clients explicitly use `db.schema = channelwright`.

Map the same project values to the production application names and build:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL=$env:CHANNELWRIGHT_SHARED_SUPABASE_URL
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY=$env:CHANNELWRIGHT_SHARED_SUPABASE_ANON_KEY
$env:SUPABASE_SERVICE_ROLE_KEY=$env:CHANNELWRIGHT_SHARED_SUPABASE_SERVICE_ROLE_KEY
$env:CHANNELWRIGHT_MOCK_MODE='false'
$env:NEXT_PUBLIC_CHANNELWRIGHT_MOCK_MODE='false'
npm.cmd run build
```

Run authenticated RLS, HTTP, RPC, lease, private Storage, real-master, signed-URL, and reconciliation checks:

```powershell
npm.cmd run gate:supabase:live
```

Expected verdict: `SHARED_PROJECT_LIVE_PATH_PASSED`, with `failed: 0` and `skipped: 0`.

When CAPTCHA is enabled for Supabase Auth, the gate preserves that production control. It confirms that the tokenless password-login route is rejected with the stable `captcha_required` boundary, then creates genuine authenticated sessions from admin-generated magic-link token hashes so authenticated HTTP and RLS paths can still be exercised non-interactively. The UI obtains a provider token and the server passes it to Supabase Auth; a human completion against the configured production Turnstile or hCaptcha widget remains a separate manual browser gate.

The live gate also starts a real `CHANNEL_CONCEPT_VALIDATION` workflow through HTTP, proves owner-scoped idempotency and cross-owner denial, exercises competing service-role claims, heartbeat, retry/failure, lease expiry recovery, deterministic typed completion, the explicit approval wait, owner-only approval, cancellation, and cleanup. It must leave no temporary workflows, runs, steps, attempts, approvals, events, users, or Storage objects.

The live gate creates two uniquely named temporary auth users and owner-scoped Channelwright records. It removes Channelwright records and objects before deleting the users, confirms both auth identities are gone, and scans shared UUID columns for leftover temporary user identifiers. Existing users, `public` records, unrelated buckets, and unrelated objects remain outside its mutation scope.

Passing this gate does not establish production readiness. Independent worker deployment/crash recovery, providers, licensing and spending policy, OAuth, publishing, production queues, and monitoring remain separate gates.
