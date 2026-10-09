import Stripe from "stripe";
import config from "./config";

// Stripe is only used server-side: the secret key never leaves the API.
// Without STRIPE_SECRET_KEY the app runs normally and only online payments are unavailable.
let client: Stripe | null = null;

export const isStripeConfigured = (): boolean => Boolean(config.stripe.secretKey);

export const getStripe = (): Stripe => {
  if (!config.stripe.secretKey) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY in the API .env.");
  }
  if (!client) {
    client = new Stripe(config.stripe.secretKey, {
      appInfo: { name: "ViaExam" },
      maxNetworkRetries: 2,
    });
  }
  return client;
};
