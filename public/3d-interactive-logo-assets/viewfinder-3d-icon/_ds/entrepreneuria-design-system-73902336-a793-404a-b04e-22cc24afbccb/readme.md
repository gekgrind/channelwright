# Entrepreneuria Design System

Entrepreneuria is a founder-focused brand and product ecosystem for solo entrepreneurs: a marketing site, a growing set of AI products, and a founder tool library. Tagline: **Build. Launch. Grow.** / **Empower. Connect. Elevate.**

**Products in the ecosystem**
- **Entrepreneuria (marketing site)** — the premium, editorial-cinematic front door: hero, product line, pricing, waitlist.
- **Prospra** — AI founder mentor/coach (in private build).
- **Architecta** — brand & content growth engine (in design).
- **Directorium** — AI board of directors for structured decision review (in design).
- **Synceri** — ops/admin automation and workflow sync (in design).
- **The Launchpad** — free AI founder tools (business model generator, financial projector, etc.) and resources/blog, live today.
- **The Exchange** — Digital Vault (asset storage) and Agentverse (AI agent network), both coming soon.
- **Command Center** — the signed-in dashboard where a founder's apps, business health score, and AI activity live.

**Sources used to build this system**
- GitHub: [gekgrind/entrepreneuria](https://github.com/gekgrind/entrepreneuria) (`main` branch) — explore it further for more product surfaces, live copy, and component behavior than are captured here.
- Attached local codebase (same repo, mounted read-only) — `app/globals.css`, `DESIGN.md`, `AGENTS.md`, `tailwind.config.js`, `components/ui/*`, `components/Header.tsx`, `components/footer.tsx`, `components/marketing/*`, `app/page.tsx`, `app/prospra/page.tsx`, `components/command-center/*`, `lib/command-center/apps.ts`.
- Uploaded logo files: `entrepreneuria-logo-nav.png`, `Entrepreneuria (512 x 512 px).png`.

## Content fundamentals

- **Voice:** direct, second-person, founder-to-founder. "You" throughout — never "our users." Confident but not hype-y: *"What you can use today. What's coming next."*
- **Honesty over spin:** the site literally has a section called "Ecosystem status" with the line *"What's live is live. What isn't is labeled."* Never oversell a product still in private build — always say so plainly (`In private build`, `In design`, `Coming soon`).
- **Sentence rhythm:** short declarative sentences, often two-line headline pairs (headline / sub-clause on its own line). Section eyebrows are numbered: `01 — The product line`.
- **Casing:** sentence case for headings and body; UPPERCASE only for DM Mono kickers/eyebrows and status labels, always with wide letter-spacing.
- **No emoji.** Iconography carries visual interest instead (see below).
- **Vibe:** VC-grade product-marketing — premium, cinematic, founder-aware, not a generic SaaS template. Copy reads like a founder talking to another founder, not a corporate brand voice.

## Visual foundations

- **Dark-first, always.** Every marketing and app surface is deep navy (`#1A2942` / `#04222B` / `#081527`) with white text — there is no light-theme variant in production use.
- **One accent, used sparingly:** electric cyan (`#00D4FF`) is *the* interactive/attention color — links, focus rings, "sign up" CTAs, live-status dots, card glows. Burnt orange (`#D27A2C`) is reserved for the single primary conversion CTA ("Join the waitlist"). The brand rule is explicit: **never mix cyan and orange inside one component.**
- **Type:** Playfair Display (serif) for all headings — mandatory for h1–h3, never swapped for sans. DM Sans for body/UI/nav/buttons. DM Mono for kickers, form labels, and anything "technical" (uppercase, wide tracking).
- **Backgrounds:** a slow 16s diagonal gradient shimmer (navy → steel-blue → orange, `background-size:400%`) drifts behind the whole site (slows to 60s while scrolling, disabled under reduced-motion). Radial glow blooms (cyan top, orange bottom-right) sit behind hero/page-hero sections. No photography-driven imagery in the product itself — one supporting photo (`assets/photo-founder-desk.jpg`) is used on auth pages.
- **Cards:** translucent glass — `rgba(255,255,255,.03)` fill, `1px solid rgba(255,255,255,.1)` border, `16px` radius. Depth comes from **cyan-tinted glow**, never a neutral drop-shadow: inset glow for "premium" cards, external glow for "floating/featured" cards. Hover intensifies the glow and/or brightens the border — cards never scale up more than a hair.
- **Buttons:** fully pill-shaped (`border-radius: 3355px`) for every primary/secondary CTA and input; `12px` radius only for compact icon buttons. Primary = orange fill; "sign up"/secondary-emphasis = cyan fill with navy text; ghost/nav = transparent, text turns cyan on hover. A diagonal shimmer sweep plays across primary buttons on hover.
- **Inputs:** pill-shaped, translucent white fill, white border at 15% opacity, cyan focus ring — never remove the border.
- **Blur & transparency:** header, dropdown menus, and dock use `backdrop-filter: blur(12–14px)` over translucent navy — used specifically for "floating over content" surfaces (header, nav dropdowns, the bottom dock, mobile menu), not for cards.
- **Animation:** entrance = fade + rise (`opacity 0→1, translateY 28px→0`, `cubic-bezier(.22,1,.36,1)`, ~0.7s), staggered via cascade groups. Hover = color/opacity/shadow changes only, plus a light lift (`translateY(-4px)`) on legacy card treatments — never dramatic scale. Everything respects `prefers-reduced-motion`.
- **Corner radii scale:** `0` (dividers/labels) → `12px` (icon buttons, small elements) → `16px` (cards, containers) → pill (buttons, inputs). Never mix radii within one component family.
- **Layout:** `1280px` max-width container, `40px`/`24px`/`16px` horizontal padding at desktop/tablet/mobile. Header is fixed, `~76px` tall, blurred navy.
- **Imagery color vibe:** cool, moody, low-saturation navy/cyan when present at all — the brand mark itself (a circular "C" glyph) glows cyan-white against black, evoking a compass/beacon (ties to the "find your true north" headline).

## Iconography

- **Library:** [Lucide](https://lucide.dev) (`lucide-react` in the codebase) — a consistent, thin-stroke line-icon set. This is a CDN-available match; component cards in this system reference it the same way.
- **No icon font, no PNG icon sprites** in the source — icons are individual Lucide React components, stroke-based, typically `16–20px`.
- **No emoji anywhere** in the product UI.
- Status is communicated with a plain colored dot (filled cyan + glow = live; hollow outline = not live) rather than an icon, so treat "the status dot" as its own small iconographic convention (see the Badge/EcosystemStatus patterns).
- Brand mark: a circular "C"-form compass/beacon glyph rendered in chrome/cyan glow on black — copied into `assets/` (see Brand cards). No separate wordmark-only lockup was provided beyond the signature PNG.

## Component coverage

The product's own `components/ui/` folder is a full shadcn/Radix kit (~35 primitives: accordion, alert, avatar, badge, breadcrumb, calendar, card, carousel, chart, checkbox, dialog, dropdown-menu, input, popover, progress, select, sidebar, switch, table, tabs, tooltip, and more). This system implements a **core subset**, restyled to the brand's actual token values (pill radii, cyan-glow shadows, Playfair/DM Sans/DM Mono) rather than generic shadcn defaults:

- **forms/** — Button, Input, Checkbox, Switch
- **feedback/** — Badge, Alert, Progress, Tooltip
- **display/** — Card, Avatar, Kbd
- **navigation/** — Tabs, Accordion
- **overlay/** — Dialog

Not yet built (present in the source but out of scope for this pass): Select, RadioGroup, Table, Breadcrumb, Calendar, Carousel, Chart, Sidebar, Command palette, Drawer/Sheet, Context menu, Menubar, Pagination, Toast/Sonner. Build these the same way — read the matching file in `components/ui/` on GitHub and restyle with these tokens — if you need them.

**Intentional additions:** none beyond the standard set above — every component here has a direct counterpart in the source kit.

## Index

- `styles.css` — root stylesheet; imports everything in `tokens/`.
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `effects.css` (radii/shadows/motion), `fonts.css`.
- `assets/` — logo lockup, nav mark, signature wordmark, one supporting photo.
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Brand groups) shown in the Design System tab.
- `components/forms/` — Button, Input, Checkbox, Switch.
- `components/feedback/` — Badge, Alert, Progress, Tooltip.
- `components/display/` — Card, Avatar, Kbd.
- `components/navigation/` — Tabs, Accordion.
- `components/overlay/` — Dialog.
- `ui_kits/marketing-site/` — homepage recreation (header w/ mega-menu, hero, product-line cards, ecosystem status, footer).
- `ui_kits/command-center/` — signed-in dashboard recreation (app grid, business health score, AI activity, quick actions).
- `SKILL.md` — Claude Code-compatible skill wrapper for this design system.
- `github.md` — sync record against the source repo.

## Caveats & ask

- **Fonts are loaded from Google Fonts by `@import`**, not self-hosted — no font binaries were provided. If you have the actual `.woff2` files the product ships, send them over and I'll self-host them properly in `tokens/fonts.css`.
- **Component coverage is a curated core set** (12 primitives), not the full ~35-component shadcn kit in the source repo — see "Component coverage" above for what's missing and how to extend.
- The two UI kits (marketing homepage, Command Center dashboard) are cosmetic recreations of the real page structure and copy, not the full page (e.g. no WebGL hero animation, no auth-gated states) — let me know if you'd like more screens (Prospra/Directorium/Architecta product pages, the waitlist form, auth/login) built out next.
- I'd love your read on whether the cyan/orange "never mix" rule and the pill-button system feel right as codified — tell me what to adjust and I'll iterate.
