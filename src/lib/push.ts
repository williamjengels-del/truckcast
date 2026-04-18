import webpush, { type PushSubscription as WebPushSubscription } from "web-push";

// TODO(Phase 8.3+): planned push triggers beyond the booking-inquiry one
// wired in Phase 8.2. Each belongs where its condition is detected:
//   - end-of-day unlogged sales reminder — TODO noted in
//     src/app/api/cron/sales-reminders/route.ts (fire in parallel with email)
//   - upcoming event (<24h) with no weather set — belongs in the future
//     weather-refresh cron (doesn't exist yet; will live under
//     /api/cron/weather-refresh per Phase 3 scope)
//   - unmatched POS payment detected — belongs in the POS sync code after
//     Phase 3 adds the unmatched_payments table and detection pass
// Ship one end-to-end trigger (new booking inquiry) in 8.2, stub the rest.

// Initialize VAPID details once at module load. Both the send route and any
// future internal caller should import sendPushToUser from here rather than
// calling webpush.sendNotification directly.
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:hello@vendcast.co";

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendResult {
  delivered: number;
  failed: number;
  invalidEndpoints: string[];
}

/**
 * Send a push payload to every subscription row provided. Collects 410/404
 * responses from push services as "invalid endpoints" — caller is expected
 * to delete those rows so we don't keep retrying dead subscriptions.
 */
export async function sendPushToSubscriptions(
  subs: PushSubscriptionRow[],
  payload: PushPayload
): Promise<SendResult> {
  if (!ensureConfigured()) {
    return { delivered: 0, failed: subs.length, invalidEndpoints: [] };
  }

  const body = JSON.stringify(payload);
  const invalidEndpoints: string[] = [];
  let delivered = 0;
  let failed = 0;

  await Promise.all(
    subs.map(async (sub) => {
      const subscription: WebPushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(subscription, body);
        delivered++;
      } catch (err) {
        failed++;
        // web-push raises WebPushError with statusCode for non-2xx responses.
        // 404 (Not Found) and 410 (Gone) = endpoint is dead, clean it up.
        const statusCode =
          (err as { statusCode?: number })?.statusCode ?? 0;
        if (statusCode === 404 || statusCode === 410) {
          invalidEndpoints.push(sub.endpoint);
        }
      }
    })
  );

  return { delivered, failed, invalidEndpoints };
}
