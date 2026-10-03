// Dodo Payments (merchant of record) helpers: webhook signature check and event → firms.plan mapping.
// Webhooks follow the Standard Webhooks spec: HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${raw body}`,
// key = base64 of the secret after the `whsec_` prefix, header = space-separated `v1,<base64>` signatures.

type BillingPlan = 'active' | 'past_due' | 'canceled';

const TOLERANCE_SECONDS = 5 * 60; // same window as the Standard Webhooks libraries
const enc = new TextEncoder();

function fromB64(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/** True only if one of the `v1` signatures matches and the timestamp is within 5 minutes of `nowSeconds`. */
export async function verifyWebhook(
  secret: string,
  headers: { id: string | undefined; timestamp: string | undefined; signature: string | undefined },
  body: string,
  nowSeconds: number,
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const keyBytes = fromB64(secret.startsWith('whsec_') ? secret.slice(6) : secret);
  if (!keyBytes) return false;
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const data = enc.encode(`${id}.${timestamp}.${body}`);
  for (const part of signature.split(' ')) {
    const [version, b64] = part.split(',');
    const sig = version === 'v1' && b64 ? fromB64(b64) : null;
    if (sig && (await crypto.subtle.verify('HMAC', key, sig, data))) return true; // constant-time compare
  }
  return false;
}

// Subscription status (Dodo SubscriptionStatus enum) → plan. pending, paused and failed leave the plan unchanged.
const BY_STATUS: Record<string, BillingPlan> = {
  active: 'active',
  past_due: 'past_due', // inside Dodo's grace period: the firm keeps working
  on_hold: 'canceled', // grace over or renewal failed: recoverable, flips back to active on payment
  cancelled: 'canceled',
  expired: 'canceled',
};

/** The plan a Dodo event moves the firm to, or null to leave it alone. Event names from Dodo's webhook events guide. */
export function planForEvent(type: string, status: unknown): BillingPlan | null {
  switch (type) {
    case 'subscription.active':
    case 'subscription.renewed':
    case 'subscription.plan_changed':
      return 'active';
    case 'subscription.past_due':
      return 'past_due';
    case 'subscription.on_hold':
    case 'subscription.cancelled':
    case 'subscription.expired':
      return 'canceled';
    case 'subscription.updated':
      return typeof status === 'string' ? (BY_STATUS[status] ?? null) : null;
    default:
      return null;
  }
}

export const dodoBaseUrl = (mode: string | undefined) =>
  mode === 'live_mode' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com';
