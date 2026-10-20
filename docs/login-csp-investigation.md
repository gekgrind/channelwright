# Production login redirect / CSP investigation

## Evidence and cause

Observed October 20, 2026, approximately 02:27 EDT, against the public HTTPS site:

- `GET /login?utm_source=chatgpt.com` returned 200. The rendered form uses `action="/api/auth/login" method="post"`; its resolved action is the same public HTTPS origin. There is no CSP meta element or base element changing the target.
- Raw HTTPS response headers contained exactly one `Content-Security-Policy`, matching `next.config.ts`: `form-action 'self'`; Turnstile's `https://challenges.cloudflare.com` is permitted in script, frame, and connection directives; `connect-src` also includes `'self'`.
- An empty form POST to the public `/api/auth/login` returned **303 `Location: https://localhost:3005/login?error=captcha_required`**. The probe supplies no credentials or CAPTCHA and exits before contacting Supabase. A second probe reproduced this redirect.
- The login handler built every redirect using `new URL(path, request.url)`. The installed Next.js 16.3.0 `next-server.js` constructs request metadata from its bound hostname/port when available (see `attachRequestMeta`). This explains the internal hostname leaking into the absolute redirect after TLS termination.
- Chrome enforces `form-action` on form redirect destinations. The initial same-origin POST is allowed, but its redirect to `https://localhost:3005` is cross-origin and blocked. Browser implementations differ; see [MDN form-action](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/form-action). The same redirect construction is used after successful provider login, provider rejection, and provider exceptions; those production branches were not exercised with an account.

The confirmed defect is the redirect destination, not an absolute versus relative form action. `utm_source` does not change the origin. A generic CSP error identifying the submitted URL does not establish that the initial POST was rejected before reaching the server.

## Policy provenance and Cloudflare boundary

There is no tracked Nginx configuration, application middleware, or Next.js proxy file in this baseline. The public server identifies as Nginx. The observed policy matches the application header generator, and no second policy was present in the sampled response. The live Nginx configuration and exact deployed SHA were not accessed, so an independently configured identical upstream header cannot be ruled out from public response headers alone.

The browser loaded Turnstile and displayed "Security check complete." No top-level Cloudflare `connect-src` violation was reproduced in that inspection; console messages originating inside the Cloudflare iframe do not establish that the parent application's policy blocked login. The originally reported blocked fetch URL and its enforcing document/policy are still needed to classify that separate symptom.

[Cloudflare's documented requirements](https://developers.cloudflare.com/turnstile/reference/content-security-policy/) specify `https://challenges.cloudflare.com` for scripts and frames and `'self'` for pre-clearance `/cdn-cgi/` fetches. All are already present; the application also explicitly allows connections to the challenge origin. No additional Cloudflare endpoint is justified by current evidence. Do not add analytics, arbitrary Cloudflare domains, or wildcard permissions to address unidentified console messages.

## Remediation and security impact

The login handler now emits 303 responses with a fixed relative `Location`: `/studio` or `/login?error=<known code>`. A private helper accepts only those destinations. It deliberately uses the `NextResponse` constructor because `NextResponse.redirect()` requires an absolute URL in this installed version. The browser resolves the path against its public origin without trusting Host, Origin, forwarded headers, or user-supplied return URLs.

No CSP permission changes, CAPTCHA bypass, credential/configuration changes, shared SSO changes, or authorization changes are included. Provider authentication and existing cookie-writing behavior remain in place; 303 still converts the follow-up navigation to GET. Fixture login remains disabled in production. Restoring secure Studio access supports the complete business loop without changing product functionality.

## Regression coverage

- The real login POST handler is tested with public, HTTPS internal, and HTTP internal request origins for validation failures, provider success, each provider error class, and provider exceptions.
- Attacker-controlled Host/forwarded headers and return destinations cannot affect Location. Missing CAPTCHA never reaches the provider, and enabling fixture mode cannot bypass production authentication.
- Development fixture redirects retain their signed HttpOnly cookie.
- Security-header tests require exactly one application CSP, exact `form-action 'self'`, and explicit Turnstile permissions, including same-origin pre-clearance connections.
- All 22 new route cases failed before the change; the targeted authentication/header suite passed 36 tests afterward. Provider responses in unit tests are mocked; they do not prove live session creation.

## Completed local validation

| Check | Result |
| --- | --- |
| Targeted auth, CAPTCHA, and CSP tests | 6 files, 36 tests passed |
| `npm.cmd test -- --pool=forks --no-file-parallelism` | 127 files, 1,788 tests passed |
| `npm.cmd run typecheck -- --incremental false` | Passed |
| `npm.cmd run lint` | Passed |
| `npm.cmd run build` | Passed with Next.js 16.3.0 / Turbopack |
| `git diff --check` and changed-file mojibake scan | Passed |
| `graphify update .` | AST graph updated; optional SQL parser unavailable, SQL graph extraction skipped |

The initial build attempts failed because of the scratch checkout's dependency layout (an external junction, then an incomplete local copy). The standard build passed once the checkout had its own complete dependency directory. No package installation, configuration change, or environment secret copy was needed. Generated `next-env.d.ts` changes were excluded from the fix.

The built application ran at `localhost:3016` behind a loopback test proxy exposed at `127.0.0.1:3017`. A native form with the same relative action and the built application's CSP submitted an empty POST to the actual login handler. The response was **303 `Location: /login?error=captcha_required`**, with one CSP header retaining `form-action 'self'` and no session cookie. Chromium navigated to `http://127.0.0.1:3017/login?error=captcha_required` and rendered "Complete the security check before signing in." No CSP error appeared in the captured console for this submission.

The same browser stayed on the probe page when a separate local response replayed the captured production redirect to `https://localhost:3005`. This replay is a controlled response fixture, not a second production browser login. The real built-handler test verifies the repaired navigation and CAPTCHA rejection, not provider success. This isolated build intentionally had no CAPTCHA configuration or Supabase credentials; it displayed the expected configuration warning and disabled sign-in button afterward.

## Read-only production inspection

Run these on the VPS to distinguish application, Nginx, and any outer proxy. They do not change configuration or create sessions. Do not publish unrelated configuration secrets from the output.

```sh
cd /var/www/channelwright
git rev-parse HEAD
sudo nginx -T 2>&1 | grep -nE 'configuration file|server_name|listen|proxy_pass|proxy_redirect|proxy_set_header|add_header.*Content-Security-Policy|more_set_headers.*Content-Security-Policy|proxy_hide_header.*Content-Security-Policy'
curl -sS -D - -o /dev/null 'https://channelwright.entrepreneuria.io/login?utm_source=chatgpt.com'
curl -sS -D - -o /dev/null -X POST -H 'Origin: https://channelwright.entrepreneuria.io' -H 'Content-Type: application/x-www-form-urlencoded' 'https://channelwright.entrepreneuria.io/api/auth/login'
curl -sS -D - -o /dev/null -H 'Host: channelwright.entrepreneuria.io' -H 'X-Forwarded-Proto: https' 'http://127.0.0.1:3005/login'
curl -sS -D - -o /dev/null -X POST -H 'Host: channelwright.entrepreneuria.io' -H 'X-Forwarded-Proto: https' -H 'Origin: https://channelwright.entrepreneuria.io' -H 'Content-Type: application/x-www-form-urlencoded' 'http://127.0.0.1:3005/api/auth/login'
```

In Windows use `curl.exe` and `NUL` instead of `curl` and `/dev/null`. Do not follow redirects when inspecting Location. After an approved release, both empty POST probes should return `/login?error=captcha_required` on this handler; inspect any outer redirect rewriting if they disagree.

In Chrome DevTools, enable Preserve log in Network and Console, reload `/login?utm_source=chatgpt.com`, and inspect all CSP response headers on the document. This read-only console expression checks the resolved target without inspecting credentials or tokens:

```js
({
  origin: location.origin,
  base: document.baseURI,
  forms: [...document.forms].map(f => ({ raw: f.getAttribute('action'), resolved: f.action, method: f.method })),
  policies: [...document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')].map(m => m.content)
})
```

For a remaining violation, capture its exact blocked URL, directive, enforcing document/frame origin, and full policy. Distinguish report-only policies from enforcing policies. Multiple enforcing CSP headers apply cumulatively; widening only one does not override another.

## Release isolation and remaining gates

Branch `codex/fix-login-csp-redirect` starts from fetched `origin/main` at `bf464961724e3304f7a1b4427ba0ac5a3f21b183`. It excludes `codex/promote-studio-journey`. The tracked deployment workflow triggers only on pushes to `main`; publishing this review branch does not deploy it.

Stop at review. Product-owner approval is required before merge/deployment. After that approval, verify the public redirect headers and use an authorized QA account to confirm CAPTCHA rejection, invalid credentials, successful login, resulting cookies, authenticated `/studio`, refresh, and logout in Chrome through the actual TLS/Nginx path. Local runtime or mocked-provider tests do not establish production login success.
