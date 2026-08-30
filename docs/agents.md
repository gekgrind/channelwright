# Agent contracts

Current agents are invoked only by the orchestrator:

| Agent | Validated output | Current implementation |
| --- | --- | --- |
| Concept Research | Evidence summary, signals, angles, risks, sources | Deterministic fixture |
| Concept Viability | Five gates, raw scores, recommendation, repairs | Deterministic fixture |
| Concept Discovery | Multiple distinct, viability-ranked candidates | Deterministic fixture |
| Channel Strategy | Positioning, pillars, formats, series, risks | Deterministic fixture |
| Content Strategist | Viewer, angle, thesis, hook, sections | Deterministic fixture |
| Video Research | Claims, source links, contradictions, unknowns | Deterministic fixture |
| Scriptwriter | Versioned hook, sections, timings, claim refs | Provider-backed (`CHANNEL_VIDEO_SCRIPT`) |
| Script QA | PASS/REVISE, scores, structured findings | Provider-backed (`CHANNEL_VIDEO_SCRIPT`) |
| TikTok Optimizer | Versioned TikTok adaptation plan with hook, pacing, captions, copy, claims, and blockers | Deterministic fixture |
| Reels Optimizer | Shared Reels media plan with separate Instagram/Facebook copy, safe-zone guidance, claims, and blockers | Deterministic fixture |
| Platform Package QA | PASS/REVISE, claim resolution, duration/config checks, fixture and master blockers | Deterministic fixture |
| Reference Channel Resolver | Canonical source identity, stable identifier, provider/access warnings | Deterministic fixture; live interface only |
| Reference Channel Research | Versioned, source-provenanced inspiration report and original recommendations | Deterministic fixture; live interface only |
| Independent Research QA | Contract, provenance, uncertainty, and originality findings | Deterministic fixture |

Each run records agent name, status, input hash, timing, fixture flag, and cost. Output parsers live in `src/domain/contracts.ts`. Provider-specific model calls must be implemented behind the agent boundary, never scattered through route handlers or UI code.

Live research must use current external evidence for competitor analysis, saturation, recent growth, trends, demand, and monetization. Historical model knowledge alone is not an acceptable live adapter.

Platform optimizers receive an approved immutable script, research artifact, video snapshot, and requested target. They return separately validated provider-independent packages and never rewrite the canonical script. The current fixture packages are production plans only: no media is rendered or inferred valid from a filename. A future live renderer must remain behind an agent boundary and attach object-storage references plus actual media-inspection results before any export-ready status is allowed.
