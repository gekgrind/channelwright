# Studio Journey homepage promotion

Local implementation and validation complete on 2026-10-19; changes remain uncommitted for review. No push, merge, deployment, DNS, database, pricing, entitlement, or SSO change is authorized by this document.

## Verified starting state

- Checkout: `C:/DevProjects/channelwright`.
- Starting branch: `feat/channelwright-phase-a-ux`, HEAD `ef5d9970bd40082a9fae2cc9ef8625fedb2f3be3`.
- Local `main` remained at `da0000ebdfbbbda599e20288217104f4aca4dedf`; it was not merged or moved.
- Fetched authoritative `origin/main`: `bf464961724e3304f7a1b4427ba0ac5a3f21b183`, merge PR #13 (Phase A). Its tree matches the starting HEAD.
- Phase A `ef5d997` and Channel Video Intelligence `dca45fd` are ancestors of main; Intelligence merge is `7ce8ed2`.
- Dedicated local implementation branch: `codex/promote-studio-journey`, based on fetched main.
- Initial active-tree changes: only untracked `.claude/settings.local.json`, left untouched.
- All eight existing worktrees were inspected. Dirty worktrees: `channelwright-audience-proof` (prototype CSS/component and three untracked PNGs), `channelwright-meticulous` (onboarding/config/auth/package work), and `cw-merge-main` (deleted design assets). The other four peer worktrees were clean. None was modified.
- Obsidian Current State was consulted for intent; its dated repository/deployment claims were superseded by this fetch and source/runtime inspection.

### Worktree inventory before editing

| Worktree under C:/DevProjects | Branch / state | Starting HEAD | Working files |
| --- | --- | --- | --- |
| channelwright | feat/channelwright-phase-a-ux | ef5d997 | Untracked local settings only |
| channelwright-audience-proof | codex/audience-footer-proof | 37f55f2 | Modified prototype TSX/CSS; three untracked PNGs |
| channelwright-fable-review | detached | 8249e1a | Clean |
| channelwright-intelligence | feat/channel-intelligence | dca45fd | Clean |
| channelwright-meticulous | chore/meticulous-onboarding | 42dfc6b | Config/package/layout/auth changes and onboarding files |
| channelwright-portfolio | feat/channel-portfolio | 7f104eb | Clean |
| channelwright-studios-audit | claude/studios-audit | f5191e2 | Clean |
| cw-merge-main | feat/studios-polish | 996f8a4 | Deleted tracked design/logo assets |

## Production evidence before editing

The public `/` returned 200 with "Build channels ... with a thesis." Its entire rendered `<main>` matched the repository legacy page byte for byte (5,364 characters). `/studios-preview` returned 200 with "Every channel starts with an idea." `/studio` returned 307 to `/login`; `/login` returned 200 with CAPTCHA configured. This is public-response evidence, not proof of every server file or asset hash.

GitHub Actions [deployment run 38946103035](https://github.com/gekgrind/channelwright/actions/runs/38946103035) succeeded for `bf464961724e3304f7a1b4427ba0ac5a3f21b183` on October 16. Public responses identify nginx. The server checkout/PM2 environment was not accessed directly.

## Recoverable legacy design

- Local annotated tag: `archive/legacy-homepage-2026-10-19`.
- Tagged source tree: `bf464961724e3304f7a1b4427ba0ac5a3f21b183`.
- Legacy page's last source change: `a1e4aa2f493a153d6b6c6129ad04fcd48d4a8505` (initial application).
- The tag preserves the entire tracked source tree, including `src/app/page.tsx`, `src/app/globals.css`, `src/app/layout.tsx`, and `public/` assets. No global styles, fonts, legacy assets, or components were removed in this promotion.
- No working-copy secrets, environment files, node_modules, or build output were archived. The existing tracked `.env.example` is a configuration template, not runtime credentials.
- The tag is local only and has not been pushed. Retain this repository/ref until separately authorized durable remote backup.

Inspect without changing files:

```powershell
git show archive/legacy-homepage-2026-10-19:src/app/page.tsx
git rev-parse 'archive/legacy-homepage-2026-10-19^{}'
git diff archive/legacy-homepage-2026-10-19 -- src/app/globals.css src/app/layout.tsx public
```

To restore the legacy homepage on a separate clean restoration branch after approval:

```powershell
git switch -c codex/restore-legacy-homepage origin/main
git restore --source=archive/legacy-homepage-2026-10-19 -- src/app/page.tsx
```

The dependencies and global styles are unchanged by this task, so restoring the old page is sufficient for this candidate. If future work changes them, inspect their tagged versions first and restore required paths selectively; do not overwrite unrelated later changes. A fully isolated historical checkout can also be created with `git worktree add --detach <unused-directory> archive/legacy-homepage-2026-10-19`.

## Changed behavior and scope

- `/`: existing `StudiosExperience`, publicly accessible, root canonical metadata, indexable under existing site defaults.
- `/studios-preview`: fixed temporary 307 redirect to `/`; old links resolve without a permanent redirect commitment. Query parameters cannot control the destination; browser fragments retain their normal same-document behavior.
- `/studio`: unchanged dynamic Server Component, awaiting `requireUser()` before returning the application.
- Journey wordmark now links to `/`; Studio CTAs target `/studio`, which admits verified users and redirects signed-out visitors to `/login`; successful login returns to `/studio`.
- Removed the preview badge and stale preview footer. Clarified the illustrative journey, manual performance capture, and the unimplemented automatic analytics integration. Publishing/upload remains explicitly unbuilt; rendering remains local proof.
- Reused all existing animation, responsive CSS, reduced-motion, focus/reveal, and asset behavior. Product Doctrine: preserve the evidence-backed Strategy -> Production -> Measurement -> Learning -> Next Decision narrative and its capability boundaries.

Application files changed: `src/app/page.tsx`, `src/app/studios-preview/page.tsx`, `src/features/studios/experience.tsx`, `capabilities.ts`, `copy.ts`, and `audience-footer.tsx`. Studio entry links were also updated in `acts.tsx`. Comments were aligned with the automatic-ingestion boundary in that file, `world.tsx`, `beats.ts`, and `artifact-plate.tsx`. Regression coverage: `src/app/homepage.test.tsx`, `src/app/studio-access.test.ts`, `src/features/studios/artifact-plate.test.ts`, and `src/features/studios/audience-footer-render.test.tsx`. This document records operations and recovery. Graphify output is generated/ignored and refreshed separately.

## Authentication findings and evidence limits

- `src/app/studio/page.tsx` awaits `requireUser()`; `src/server/auth.ts` checks Supabase `auth.getUser()`, not an unverified browser token, before exposing Studio.
- `src/server/config.ts` prevents fixture auth in production even if the fixture environment switch is enabled.
- `src/app/api/workflows/route.ts` separately requires the current user for GET and POST; protecting the page is not its sole gate.
- Existing login posts to `/api/auth/login`, requires CAPTCHA in production, and always sends success to the fixed `/studio` path. User-supplied `next` / `returnTo` values are unused, so no new return-URL parser or SSO contract is introduced. Tests cover external, protocol-relative and backslash targets.
- Existing Supabase SSR cookie handling, logout, provider configuration, and shared authentication behavior are unchanged. This does not establish end-to-end multi-app SSO correctness.
- Pre-existing gap: no sign-up page or sign-up link exists. Do not invent a provider flow or send users to an unverified destination. Product-owner selection of the existing authorized registration path is required before claiming self-service sign-up works.
- Real authenticated production/browser login, CAPTCHA completion, token refresh, and cross-app SSO were not exercised without an authorized QA identity. Mocked-provider authenticated-route tests are explicitly narrower evidence.

## Validation

- Focused Journey, CAPTCHA/login and production-auth suites: **13 files / 86 tests PASS** on the final CTA changes. Includes actual reduced-motion rendering, all in-page anchor targets, protected Studio CTA destinations, legacy-link redirect, verified/missing user cases, production fixture-disable, CAPTCHA forwarding/rejection, and hostile return targets.
- `npm.cmd run typecheck`: PASS, including a rerun after restoring build-generated changes to `next-env.d.ts`.
- `npm.cmd run lint`: PASS on final changes.
- `npm.cmd run build`: PASS on final functional changes; root and redirect are static, Studio remains dynamic. Build-generated `next-env.d.ts` changes were removed from the candidate.
- Initial unscoped/threaded full-suite invocations stalled before reporting results and were interrupted. Source-only discovery returned all 127 source test files. The forked full run (`npm.cmd test -- --dir src --pool=forks --reporter=dot`) completed: **126 files passed / 1 failed; 1,769 tests passed / 1 failed**. Failure: unchanged `src/features/studio/video-performance-workspace.test.tsx`, "submits a snapshot only for the exact release it was entered for", could not find the selected approved release region at helper line 39. Its isolated rerun passed **4/4**. No Phase A source or tests were changed; this is a timing-sensitive failure in an unchanged area, but a pre-existing clean-base full-suite failure has not been conclusively established. **Final rerun with no concurrent build/lint work: all 127 files / 1,770 tests PASS** using `npm.cmd test -- --dir src --pool=forks --silent --reporter=dot` (166.11 seconds). Keep the earlier timing-sensitive failure visible; no unrelated test or implementation was changed to obtain this pass.
- Built-app HTTP: `/` 200 (Journey title/canonical, no preview flag); `/studios-preview` 307 to `/`, including with a hostile query; `/studio` 307 to `/login`; `/login` 200; unauthenticated workflow GET and media-upload POST 401. The audience video asset returned 200. Final cinematic root HTML exposes three `/studio` CTAs and no `/studios-preview` navigation.
- Browser: inspected desktop opening/scroll scenes and register navigation; clicked Studio entry to verify sign-in. Inspected the final mobile 390x844 reduced-motion document with working `/studio` links. Temporary viewport/media overrides were restored. These are spot checks, not an exhaustive continuous-motion/accessibility audit or a real-device test.
- Archive: tag object resolves to the verified base, legacy page is readable, and global styles/layout/public assets are identical to the tagged versions.
- `git diff --check`: PASS. Auth/application/API/deployment/policy source diff: empty. No subscription policy or dependency change.
- `graphify update .`: PASS for AST graph; it warned that optional `tree_sitter_sql` is absent and community labels need refresh. No packages installed and no LLM labeling run.

Visual evidence (local files outside the candidate source tree):

- `C:/Users/gekgr/.codex/visualizations/2026/10/19/01a1552f-dfb4-7531-850f-2bf4309e3b43/studio-journey-homepage.png`
- `C:/Users/gekgr/.codex/visualizations/2026/10/19/01a1552f-dfb4-7531-850f-2bf4309e3b43/studio-journey-mobile-reduced-motion.png`

## Exact existing deployment procedure (only after explicit approval)

1. Review this branch/diff and resolve the registration/authenticated-QA gates above as required by the release owner. Commit only this slice; exclude the untracked local settings. Refresh main and rerun checks if main advances.
2. Obtain explicit product-owner authorization to push and merge the promotion. No PR, branch or archive tag has been pushed by this task.
3. Merge the reviewed promotion into `main` using the normal repository workflow. **A push to main automatically deploys** through `.github/workflows/deploy.yml`; merging is therefore also a production deployment trigger.
4. The existing workflow's `appleboy/ssh-action@v1.2.2` connects using repository SSH secrets, runs in `/var/www/channelwright`, executes `git fetch origin`, `git reset --hard origin/main`, `npm ci`, `npm run typecheck`, `npm run build`, then `PORT=3005 pm2 restart channelwright --update-env` and `pm2 save`.
5. Before approving that trigger, verify the server has no needed uncommitted work because its existing deploy script uses a hard reset. Record the previous deployed SHA and confirm the PM2 environment is correct. This task does not change that script or any secrets.
6. Watch the GitHub deployment result. Confirm production `/` = Journey/200; `/studios-preview` = 307 to `/`; unauthenticated `/studio` = 307 to `/login`; `/login` loads; an authorized signed-in user reaches Studio. Check desktop/mobile/reduced-motion, navigation, assets, and absence of preview claims. No migration or DNS change is needed.

## Rollback procedure (requires explicit approval)

Prefer a reviewed revert of the future promotion commit/PR on current main, preserving subsequent unrelated work. For an ordinary single promotion commit, create a rollback branch from refreshed `origin/main`, run `git revert <promotion-commit-sha>`, run tests/typecheck/lint/build, review and obtain approval to merge. If the promotion is a merge commit, review its parents and use the appropriate mainline (`git revert -m 1 <promotion-merge-sha>` when parent 1 is main). Merging the approved rollback to main triggers the same production workflow. Verify `/` serves the legacy headline and `/studios-preview` serves the original Journey again, and confirm Studio auth remains intact. The local archive tag independently preserves the original design even if later history evolves.

Do not reset production/main to the archive tag to undo unrelated later work. Do not execute a rollback, push, or deployment based solely on these documented instructions.

## Final disposition

Local candidate validated; awaiting product-owner approval before any merge or deployment. Registration remains a pre-existing product gap; real authenticated/CAPTCHA/SSO QA still requires an authorized QA identity. The temporary local production server was stopped and browser viewport/media overrides were restored. The archive tag remains local only. No commits, pushes, merges, deployments, DNS changes or database mutations were performed.
