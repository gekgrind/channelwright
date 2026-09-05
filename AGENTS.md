# AGENTS.md

## Channelwright Product Doctrine

Before planning or implementing substantial Channelwright functionality, read:

`docs/PRODUCT_DOCTRINE.md`

Treat that document as a binding product constraint.

Core positioning:

- Channelwright is **not** "AI YouTube Automation."
- Channelwright is **the AI operating system for building and running a profitable YouTube media business.**
- Channelwright should **manage the business, not merely automate the content factory.**

## Required Product Check

For each substantial feature or architectural change:

1. Identify which part of the Channelwright business loop it strengthens:
   `Opportunity → Validation → Strategy → Production → Distribution → Measurement → Learning → Monetization → Next Decision`
2. Prefer evidence-backed strategy over generic AI-generated recommendations.
3. Preserve viewer value, originality, business viability, strategic learning, and durable decision history where relevant.
4. Do not optimize primarily for publishing volume or generic content automation.
5. Redesign or reject approaches that move Channelwright toward a faceless-channel content factory, generic SEO tool, upload scheduler, or disconnected collection of AI generators.
6. If a requested implementation conflicts with `docs/PRODUCT_DOCTRINE.md`, stop and surface the conflict before implementing it.

## Implementation Discipline

- Keep changes scoped to the requested slice.
- Inspect existing architecture before introducing new abstractions.
- Reuse existing durable workflow, QA, approval, accounting, security, and persistence patterns rather than creating parallel systems.
- Preserve backward compatibility unless the task explicitly requires a breaking change.
- Do not weaken authentication, authorization, ownership isolation, RLS, usage accounting, provenance, approval gates, or failure recovery for convenience.
- Add or update tests for material behavior changes.
- Do not push, deploy, apply database migrations, or mutate production services unless explicitly instructed.

## Verification

Before declaring implementation complete, run the relevant available checks, normally:

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

Report failures accurately. Do not hide skipped verification.

## Output Style

Keep completion reports concise and decision-oriented:

- what changed
- why it supports the Product Doctrine
- tests/verification performed
- remaining risks or follow-up work

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## KNOWLEDGE RETRIEVAL POLICY

Use the smallest authoritative source needed for the task.

1. Project history, prior decisions, current state, handoffs, or product intent:
   - Query/read Obsidian first.
   - Prefer Channelwright Current State, Agent Handoffs, Decisions, Architecture, and Graphify notes.
   - Do not reconstruct known project history by rereading the repository when durable notes already answer it.

2. Code architecture, dependencies, symbol relationships, likely implementation files, or blast radius:
   - Use Graphify first.
   - For a known symbol, prefer:
     graphify explain "SymbolName"
   - For relationships between known nodes, prefer Graphify path/relationship traversal.
   - For discovery, use a narrow Graphify query with a small token budget, normally <=1200 tokens.
   - Avoid broad Graphify BFS queries when a known symbol can be explained directly.

3. Exact implementation behavior:
   - Git/source code is authoritative.
   - After Obsidian or Graphify identifies the relevant area, read only the exact files and line ranges required to verify or modify implementation.

4. Broad repo search:
   - Use repo-wide grep/search only when targeted Obsidian, Graphify, and source retrieval cannot resolve the question.
   - Prefer exact symbols and narrow paths over large directory searches.

5. Authority:
   - Git/source = current implementation truth.
   - Obsidian = durable project decision/history truth.
   - Graphify = derived structural guidance.
   - Graphify INFERRED or AMBIGUOUS relationships must be verified against source before being treated as fact.

6. Context efficiency:
   - Do not reread files already inspected unless an edit or new evidence makes the relevant section stale.
   - Do not dump entire migrations, diffs, logs, or large source files when targeted ranges are sufficient.
