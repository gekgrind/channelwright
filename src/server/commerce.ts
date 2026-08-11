import { randomUUID } from "node:crypto";

export interface CommerceCheckoutInput { productId: string; priceId: string; customerReference: string; }
export interface CommerceCheckoutResult { provider: string; checkoutId: string; fixture: boolean; }
export interface VerifiedCommerceEvent { provider: string; providerEventId: string; checkoutId: string; type: "PAYMENT_CONFIRMED" | "PAYMENT_REFUNDED"; verified: true; fixture: boolean; }

export interface CommerceAdapter {
  readonly providerName: string;
  readonly mode: "fixture" | "live";
  createCheckout(input: CommerceCheckoutInput): CommerceCheckoutResult;
  verifyEvent(input: Omit<VerifiedCommerceEvent, "provider" | "verified" | "fixture">): VerifiedCommerceEvent;
}

export class FixtureCommerceAdapter implements CommerceAdapter {
  readonly providerName = "fixture-commerce-v1";
  readonly mode = "fixture" as const;
  createCheckout(input: CommerceCheckoutInput): CommerceCheckoutResult { void input; return { provider: this.providerName, checkoutId: `fixture_checkout_${randomUUID()}`, fixture: true }; }
  verifyEvent(input: Omit<VerifiedCommerceEvent, "provider" | "verified" | "fixture">): VerifiedCommerceEvent { return { ...input, provider: this.providerName, verified: true, fixture: true }; }
}
