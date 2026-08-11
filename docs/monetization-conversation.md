# Monetization and conversational revisions

## Monetization plan

The fixture Monetization Agent evaluates thirteen named revenue streams. Every stream carries channel fit, verified public facts, assumptions or estimates, eligibility dependencies, time to first revenue, setup and ongoing effort, margin characteristics, risks, integrations, timing, priority, next actions, and metrics. A separate deterministic QA pass validates the contract before human review.

The report is not a revenue forecast. It has no live audience, eligibility, conversion, price-sensitivity, sponsor-demand, or profitability data. Its provenance and unknowns remain visible. A user revision creates a child plan version; approval accepts only the current exact version.

## Conversation workspace

The left conversation pane combines owner-scoped audit events, agent runs, and persisted user change requests. The composer is enabled only when a supported artifact is awaiting review. It maps the instruction to a validated workflow action for reference reports, business strategies, monetization plans, build specifications, build artifacts, or scripts.

After the action succeeds, the fixture repository stores:

- the user message;
- the target artifact type and resulting artifact identifier;
- a structured change request with the created version;
- an audit event.

Approved artifacts are never edited in place. Build rollback is also implemented as "restore as new version." A failed action is not saved and therefore cannot leave a conversation record that falsely claims a revision was applied.

## Explicit blockers

- Agent runs are deterministic fixtures with zero-dollar cost; no model provider is called.
- No live analytics or monetization eligibility is retrieved.
- No generated project is executed, scanned, tested, or deployed by this fixture path.
- No payment or email provider is configured; commerce and delivery events are unmistakable fixtures.
- The production workflow API remains HTTP 501 until a transactional Supabase repository and live adapters are implemented and tested.
