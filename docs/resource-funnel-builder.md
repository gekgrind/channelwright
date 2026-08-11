# Resource and funnel builder

A selected free resource can create a versioned build project. The deterministic Product Builder first returns a typed specification containing approved templates, dependency allowlists, resource limits, security controls, frontend/backend/database requirements, tests, setup notes, and deployment blockers. Human approval of the exact specification version is required before artifact generation.

The current artifact is a **fixture contract preview**, not executed generated code. It includes a safe relative-path file manifest, resource metadata, opt-in/thank-you/access previews, a delivery backend plan, admin controls, and QA. Isolation, dependency installation, secret scanning, static analysis, tests, and resource-limit enforcement are recorded as `NOT_RUN`; no claim is made that a generated workspace passed them.

Artifact changes create new immutable versions. An older artifact can be restored only by creating a new version. Exact-version approval moves the project to `DEPLOYMENT_BLOCKED`, because object storage, public rate limiting, bot protection, email delivery, and the production repository are not configured and live-tested.

The authenticated fixture preview can validate and normalize an email, scope it through the build project to its owner/channel, record a separate consent event, handle duplicates uniformly, hash an expiring fixture access token, and record a `DELIVERED_FIXTURE` event. It does not send email or provide a public funnel endpoint, and it must not be described as live delivery.
