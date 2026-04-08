/**
 * VendCast email sending via Resend.
 *
 * Setup:
 *   1. Sign up at https://resend.com
 *   2. Add vendcast.co as a sending domain (auto-configure via Cloudflare)
 *   3. Create an API key and add to Vercel env vars:
 *        RESEND_API_KEY=re_xxxxxxxxx
 *        EMAIL_FROM=TruckCast by VendCast <hello@vendcast.co>
 */

import { Resend } from "resend";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY!);
}

const FROM =
  process.env.EMAIL_FROM ?? "TruckCast by VendCast <hello@vendcast.co>";

const APP_URL = "https://vendcast.co";

// ─── Welcome Email ─────────────────────────────────────────────────────────

export async function sendWelcomeEmail(to: string, businessName: string) {
  if (!process.env.RESEND_API_KEY) return;

  const resend = getResend();
  const displayName = businessName || "there";

  await resend.emails.send({
    from: FROM,
    to,
    subject: "Welcome to TruckCast 🚚",
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">

    <!-- Header -->
    <div style="background:#f97316;padding:32px 40px;">
      <div style="color:white;font-size:28px;font-weight:800;letter-spacing:-1px;">TruckCast</div>
      <div style="color:rgba(255,255,255,0.8);font-size:12px;margin-top:2px;font-weight:500;letter-spacing:0.5px;">by VendCast</div>
      <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:6px;">Event forecasting for food trucks</div>
    </div>

    <!-- Body -->
    <div style="padding:40px;">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">Welcome, ${displayName}! 👋</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">
        You've got <strong>14 days</strong> to explore TruckCast — no credit card needed.
        Here's how to get the most out of it:
      </p>

      <!-- Steps -->
      <div style="background:#f9fafb;border-radius:8px;padding:24px;margin-bottom:24px;">
        <div style="margin-bottom:16px;display:flex;gap:12px;">
          <div style="width:28px;height:28px;background:#f97316;border-radius:50%;color:white;font-weight:700;font-size:13px;flex-shrink:0;text-align:center;line-height:28px;">1</div>
          <div>
            <div style="font-weight:600;color:#111827;font-size:14px;">Import your past events</div>
            <div style="color:#6b7280;font-size:13px;margin-top:2px;">Upload a CSV from Airtable, Square, Google Sheets, or Excel — we'll auto-detect the columns.</div>
          </div>
        </div>
        <div style="margin-bottom:16px;display:flex;gap:12px;">
          <div style="width:28px;height:28px;background:#f97316;border-radius:50%;color:white;font-weight:700;font-size:13px;flex-shrink:0;text-align:center;line-height:28px;">2</div>
          <div>
            <div style="font-weight:600;color:#111827;font-size:14px;">Check your forecasts</div>
            <div style="color:#6b7280;font-size:13px;margin-top:2px;">Even a few events unlock your first forecast. The more you add, the sharper it gets — calibrated to your actual history, not a generic average.</div>
          </div>
        </div>
        <div style="display:flex;gap:12px;">
          <div style="width:28px;height:28px;background:#f97316;border-radius:50%;color:white;font-weight:700;font-size:13px;flex-shrink:0;text-align:center;line-height:28px;">3</div>
          <div>
            <div style="font-weight:600;color:#111827;font-size:14px;">Log sales after each event</div>
            <div style="color:#6b7280;font-size:13px;margin-top:2px;">The more data you add, the sharper your forecasts get. Every event makes the model smarter.</div>
          </div>
        </div>
      </div>

      <a href="${APP_URL}/dashboard" style="display:inline-block;background:#f97316;color:white;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;text-decoration:none;">
        Open TruckCast →
      </a>

      <p style="margin:32px 0 0;font-size:13px;color:#9ca3af;line-height:1.5;">
        Questions? Just reply to this email — it goes straight to Julian, the food truck operator who built TruckCast.
      </p>
    </div>

    <!-- Footer -->
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">
        TruckCast by VendCast · Built by Wok-O Taco, St. Louis MO ·
        <a href="${APP_URL}/dashboard/settings" style="color:#9ca3af;">Manage preferences</a>
      </p>
    </div>
  </div>
</body>
</html>
    `.trim(),
  });
}

// ─── Post-Event Sales Reminder ─────────────────────────────────────────────

export interface UnloggedEvent {
  event_name: string;
  event_date: string;
}

export async function sendSalesReminderEmail(
  to: string,
  businessName: string,
  events: UnloggedEvent[]
) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = getResend();

  const displayName = businessName || "there";
  const count = events.length;
  const subject =
    count === 1
      ? `Don't forget — log your sales from ${events[0].event_name}`
      : `${count} events need sales logged in TruckCast`;

  function formatDate(iso: string) {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  const eventRows = events
    .map(
      (e) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#111827;font-weight:500;">${e.event_name}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280;text-align:right;">${formatDate(e.event_date)}</td>
    </tr>`
    )
    .join("");

  await resend.emails.send({
    from: FROM,
    to,
    subject,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#f97316;padding:32px 40px;">
      <div style="color:white;font-size:28px;font-weight:800;letter-spacing:-1px;">TruckCast</div>
      <div style="color:rgba(255,255,255,0.8);font-size:12px;margin-top:2px;font-weight:500;">by VendCast</div>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Log your sales, ${displayName} 📋</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">
        ${count === 1 ? "This past event is" : `These ${count} past events are`} missing sales data.
        Logging actuals keeps your forecasts sharp — it only takes a second.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr>
            <th style="text-align:left;font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;padding-bottom:8px;border-bottom:2px solid #f3f4f6;">Event</th>
            <th style="text-align:right;font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;padding-bottom:8px;border-bottom:2px solid #f3f4f6;">Date</th>
          </tr>
        </thead>
        <tbody>${eventRows}</tbody>
      </table>
      <a href="${APP_URL}/dashboard/events?tab=past" style="display:inline-block;background:#f97316;color:white;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;text-decoration:none;">
        Log sales now →
      </a>
      <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;">
        Each logged event trains your forecast model — the payoff compounds over time.
      </p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">TruckCast by VendCast · <a href="${APP_URL}/dashboard/settings" style="color:#9ca3af;">Manage preferences</a></p>
    </div>
  </div>
</body>
</html>
    `.trim(),
  });
}

// ─── Trial Expiry Warning Email ─────────────────────────────────────────────

export async function sendTrialExpiryEmail(
  to: string,
  businessName: string,
  daysLeft: number
) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = getResend();

  const isUrgent = daysLeft <= 2;
  const subject = isUrgent
    ? `⚠️ Your TruckCast trial ends tomorrow`
    : `Your TruckCast trial ends in ${daysLeft} days`;

  await resend.emails.send({
    from: FROM,
    to,
    subject,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:${isUrgent ? "#dc2626" : "#f97316"};padding:32px 40px;">
      <div style="color:white;font-size:28px;font-weight:800;letter-spacing:-1px;">TruckCast</div>
      <div style="color:rgba(255,255,255,0.8);font-size:12px;margin-top:2px;font-weight:500;">by VendCast</div>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">
        ${isUrgent ? "Last chance" : `${daysLeft} days left`} on your free trial
      </h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">
        Hey ${businessName || "there"} — your 14-day trial ${isUrgent ? "ends tomorrow" : `ends in ${daysLeft} days`}.
        Upgrade now to keep your event history, forecasts, and analytics.
      </p>
      <a href="${APP_URL}/dashboard/settings?upgrade=true" style="display:inline-block;background:${isUrgent ? "#dc2626" : "#f97316"};color:white;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;text-decoration:none;">
        View plans &amp; upgrade →
      </a>
      <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;">
        Plans start at $19/month. Cancel anytime.
      </p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">TruckCast by VendCast · <a href="${APP_URL}/dashboard/settings" style="color:#9ca3af;">Manage preferences</a></p>
    </div>
  </div>
</body>
</html>
    `.trim(),
  });
}

// ─── Trial Expired Email ────────────────────────────────────────────────────

export async function sendTrialExpiredEmail(to: string, businessName: string) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = getResend();

  await resend.emails.send({
    from: FROM,
    to,
    subject: "Your TruckCast trial has ended",
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#f97316;padding:32px 40px;">
      <div style="color:white;font-size:28px;font-weight:800;letter-spacing:-1px;">TruckCast</div>
      <div style="color:rgba(255,255,255,0.8);font-size:12px;margin-top:2px;font-weight:500;">by VendCast</div>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">Your trial has ended</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">
        Hey ${businessName || "there"} — your TruckCast free trial has ended.
        Your data is safe and waiting for you. Upgrade to restore full access.
      </p>
      <a href="${APP_URL}/dashboard/settings?upgrade=true" style="display:inline-block;background:#f97316;color:white;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;text-decoration:none;">
        Upgrade to continue →
      </a>
      <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;">Plans start at $19/month. Cancel anytime.</p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">TruckCast by VendCast · <a href="${APP_URL}/dashboard/settings" style="color:#9ca3af;">Manage preferences</a></p>
    </div>
  </div>
</body>
</html>
    `.trim(),
  });
}
