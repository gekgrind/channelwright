# Paid-product builder and commerce boundary

A selected paid-product candidate creates a separate constrained build project. Its specification covers frontend, backend, authentication, storage, administration, tests, support, provider-neutral checkout, verified webhooks, idempotent fulfillment, refunds, and entitlement revocation. The current output remains a fixture contract: no workspace is executed and every execution check is `NOT_RUN`.

After exact artifact approval, the project remains `DEPLOYMENT_BLOCKED`. Fixture mode can activate an unmistakably fixture-only product and pricing hypothesis for domain testing. Checkout creation records a `PENDING` purchase and never grants access. Only a server-side fixture commerce event verified through `CommerceAdapter` can mark the purchase paid and create one idempotent entitlement. Replayed provider event IDs do not duplicate fulfillment. A later verified refund event marks the purchase refunded and revokes the entitlement.

The browser redirect is never trusted as payment proof. Production still requires a live adapter, real signature verification over the raw request body, a transactional repository, customer authentication, object storage, support/refund procedures, and live end-to-end testing. No fixture event charges a customer or creates a live provider object.
