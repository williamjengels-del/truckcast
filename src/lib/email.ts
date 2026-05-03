/**
 * VendCast email sending via Resend.
 *
 * Setup:
 *   1. Sign up at https://resend.com
 *   2. Add vendcast.co as a sending domain (auto-configure via Cloudflare)
 *   3. Create an API key and add to Vercel env vars:
 *        RESEND_API_KEY=re_xxxxxxxxx
 *        EMAIL_FROM=VendCast <hello@vendcast.co>
 */

import { Resend } from "resend";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY!);
}

const FROM =
  process.env.EMAIL_FROM ?? "VendCast <hello@vendcast.co>";

const APP_URL = "https://vendcast.co";

// ─── Welcome Email ─────────────────────────────────────────────────────────

export async function sendWelcomeEmail(to: string, businessName: string) {
  if (!process.env.RESEND_API_KEY) return;

  const resend = getResend();
  const displayName = businessName || "there";

  await resend.emails.send({
    from: FROM,
    to,
    subject: "Welcome to VendCast 🚚",
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">

    <!-- Header -->
    <div style="background:#f97316;padding:32px 40px;">
      <div style="color:white;font-size:28px;font-weight:800;letter-spacing:-1px;">VendCast</div>
      <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:6px;">Event forecasting for food trucks</div>
    </div>

    <!-- Body -->
    <div style="padding:40px;">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">Welcome, ${displayName}! 👋</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">
        You've got <strong>14 days</strong> to explore VendCast — no credit card needed.
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

      <a href="${APP_URL}/dashboard/onboarding" style="display:inline-block;background:#f97316;color:white;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;text-decoration:none;">
        Finish setup (2 min) →
      </a>

      <p style="margin:32px 0 0;font-size:13px;color:#9ca3af;line-height:1.5;">
        Questions? Just reply to this email — it goes straight to Julian, the food truck operator who built VendCast.
      </p>
    </div>

    <!-- Footer -->
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">
        VendCast · Built by Wok-O Taco, St. Louis MO ·
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
      : `${count} events need sales logged in VendCast`;

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
      <div style="color:white;font-size:28px;font-weight:800;letter-spacing:-1px;">VendCast</div>
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
      <p style="margin:0;font-size:12px;color:#9ca3af;">VendCast · <a href="${APP_URL}/dashboard/settings" style="color:#9ca3af;">Manage preferences</a></p>
    </div>
  </div>
</body>
</html>
    `.trim(),
  });
}

// ─── Booking Inquiry Email ─────────────────────────────────────────────────

/**
 * Fired from /api/book/submit alongside the push notification when a
 * booking inquiry lands. Sent to the operator, not the requester.
 *
 * booking_requests doesn't carry a location field (neither the form nor
 * the schema collect one), so we omit it — callers pass what's actually
 * in the table.
 */
export interface BookingInquiryEmailPayload {
  businessName: string;
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string | null;
  eventDate: string | null;
  startTime: string | null;
  endTime: string | null;
  eventType: string;
  location: string;
  attendanceRange: string;
  message: string | null;
}

function formatTimeRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  const fmt = (t: string) => {
    // input is HH:MM (24h). Render as 12h with am/pm.
    const [h, m] = t.split(":").map(Number);
    if (Number.isNaN(h)) return t;
    const period = h >= 12 ? "pm" : "am";
    const hour12 = ((h + 11) % 12) + 1;
    return m ? `${hour12}:${String(m).padStart(2, "0")}${period}` : `${hour12}${period}`;
  };
  if (start && end) return `${fmt(start)}–${fmt(end)}`;
  return start ? `${fmt(start)} start` : `${fmt(end!)} end`;
}

export async function sendBookingInquiryEmail(
  to: string,
  payload: BookingInquiryEmailPayload
) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = getResend();

  const displayName = payload.businessName || "there";
  const formatDate = (iso: string) =>
    new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  // Priority order for triage: location → attendance → event type → date →
  // time → contact info. Message gets its own separated block below.
  const detailRows: { label: string; value: string }[] = [];
  detailRows.push({ label: "Location", value: payload.location });
  detailRows.push({ label: "Expected attendance", value: payload.attendanceRange });
  detailRows.push({ label: "Event type", value: payload.eventType });
  if (payload.eventDate) detailRows.push({ label: "Event date", value: formatDate(payload.eventDate) });
  const timeRange = formatTimeRange(payload.startTime, payload.endTime);
  if (timeRange) detailRows.push({ label: "Time", value: timeRange });
  detailRows.push({ label: "Contact email", value: payload.requesterEmail });
  if (payload.requesterPhone) detailRows.push({ label: "Contact phone", value: payload.requesterPhone });

  const detailsHtml = detailRows
    .map(
      (r) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;width:40%;vertical-align:top;">${r.label}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#111827;">${escapeHtml(r.value)}</td>
    </tr>`
    )
    .join("");

  const messageBlock = payload.message
    ? `
      <div style="background:#f9fafb;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <div style="font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Message</div>
        <div style="font-size:14px;color:#374151;line-height:1.6;white-space:pre-wrap;">${escapeHtml(payload.message)}</div>
      </div>`
    : "";

  await resend.emails.send({
    from: FROM,
    to,
    subject: `New booking inquiry from ${payload.requesterName}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#f97316;padding:32px 40px;">
      <div style="color:white;font-size:28px;font-weight:800;letter-spacing:-1px;">VendCast</div>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">New booking inquiry, ${displayName} 📬</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">
        <strong>${escapeHtml(payload.requesterName)}</strong> wants to book you. Reply fast — inquiries that sit go cold.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
        <tbody>${detailsHtml}</tbody>
      </table>
      ${messageBlock}
      <a href="${APP_URL}/dashboard/bookings" style="display:inline-block;background:#f97316;color:white;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;text-decoration:none;margin-top:16px;">
        Open Inbox →
      </a>
      <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;">
        You can reply directly to <a href="mailto:${payload.requesterEmail}" style="color:#9ca3af;">${payload.requesterEmail}</a> or manage the inquiry in your VendCast Inbox.
      </p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">VendCast · <a href="${APP_URL}/dashboard/settings" style="color:#9ca3af;">Manage preferences</a></p>
    </div>
  </div>
</body>
</html>
    `.trim(),
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Onboarding Nudge Email ────────────────────────────────────────────────

/**
 * Sent ~24h after signup if the user hasn't completed onboarding.
 * Goal: bring them back to the setup wizard with a low-pressure reminder.
 */
export async function sendOnboardingNudgeEmail(to: string) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = getResend();

  await resend.emails.send({
    from: FROM,
    to,
    subject: "One quick step left to set up VendCast",
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">

    <!-- Header -->
    <div style="background:#f97316;padding:32px 40px;">
      <div style="color:white;font-size:28px;font-weight:800;letter-spacing:-1px;">VendCast</div>
    </div>

    <!-- Body -->
    <div style="padding:40px;">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">You're almost in 👋</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">
        You signed up for VendCast but haven't finished setting up your account yet.
        It takes about 2 minutes — just your truck name and you're in.
      </p>

      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:20px;margin-bottom:24px;">
        <div style="font-weight:600;color:#9a3412;font-size:14px;margin-bottom:8px;">What you'll unlock:</div>
        <div style="display:flex;gap:10px;margin-bottom:10px;">
          <div style="color:#f97316;font-size:16px;flex-shrink:0;">📅</div>
          <div style="font-size:14px;color:#374151;">Event calendar with revenue forecasts for every booking</div>
        </div>
        <div style="display:flex;gap:10px;margin-bottom:10px;">
          <div style="color:#f97316;font-size:16px;flex-shrink:0;">📊</div>
          <div style="font-size:14px;color:#374151;">Import your past events to calibrate predictions to your truck</div>
        </div>
        <div style="display:flex;gap:10px;">
          <div style="color:#f97316;font-size:16px;flex-shrink:0;">🎯</div>
          <div style="font-size:14px;color:#374151;">Know which events are worth doing before you commit</div>
        </div>
      </div>

      <a href="${APP_URL}/dashboard/onboarding" style="display:inline-block;background:#f97316;color:white;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;text-decoration:none;">
        Finish setup (2 min) →
      </a>

      <p style="margin:32px 0 0;font-size:13px;color:#9ca3af;line-height:1.5;">
        Questions? Just reply — it goes straight to Julian, the food truck operator who built this.
      </p>
    </div>

    <!-- Footer -->
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">
        VendCast · Built by Wok-O Taco, St. Louis MO ·
        <a href="${APP_URL}/dashboard/settings" style="color:#9ca3af;">Manage preferences</a>
      </p>
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
    ? `⚠️ Your VendCast trial ends tomorrow`
    : `Your VendCast trial ends in ${daysLeft} days`;

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
      <div style="color:white;font-size:28px;font-weight:800;letter-spacing:-1px;">VendCast</div>
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
      <p style="margin:0;font-size:12px;color:#9ca3af;">VendCast · <a href="${APP_URL}/dashboard/settings" style="color:#9ca3af;">Manage preferences</a></p>
    </div>
  </div>
</body>
</html>
    `.trim(),
  });
}

// ─── Trial Expired Email ────────────────────────────────────────────────────

/**
 * @param gracePeriodActive - When true (before May 1 hard gate), the copy is softer:
 *   "trial ended, but you still have full access until May 1." After May 1, the
 *   copy is direct: "upgrade to restore full access."
 */
export async function sendTrialExpiredEmail(
  to: string,
  businessName: string,
  gracePeriodActive = false
) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = getResend();

  const bodyText = gracePeriodActive
    ? `Hey ${businessName || "there"} — your VendCast free trial has ended, but your access isn't going anywhere yet. You have full dashboard access until <strong>May 1, 2026</strong>. Use this time to add your events and run some forecasts — then decide if VendCast is worth keeping.`
    : `Hey ${businessName || "there"} — your VendCast free trial has ended. Your data is safe and waiting for you. Upgrade to restore full access.`;

  const ctaText = gracePeriodActive ? "View upgrade options" : "Upgrade to continue →";

  await resend.emails.send({
    from: FROM,
    to,
    subject: "Your VendCast trial has ended",
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#f97316;padding:32px 40px;">
      <div style="color:white;font-size:28px;font-weight:800;letter-spacing:-1px;">VendCast</div>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">Your trial has ended</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">${bodyText}</p>
      <a href="${APP_URL}/dashboard/settings?upgrade=true" style="display:inline-block;background:#f97316;color:white;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;text-decoration:none;">
        ${ctaText}
      </a>
      <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;">Plans start at $19/month. Cancel anytime.</p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">VendCast · <a href="${APP_URL}/dashboard/settings" style="color:#9ca3af;">Manage preferences</a></p>
    </div>
  </div>
</body>
</html>
    `.trim(),
  });
}

// ─── Contact Form ──────────────────────────────────────────────────────────

export interface ContactFormPayload {
  name: string;
  email: string;
  subject: string;
  message: string;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** ISO UTC timestamp of the submission. */
  submittedAt: string;
  /** Human-readable Central-time version of submittedAt for Julian's inbox. */
  submittedAtCentral: string;
}

/**
 * Send a contact-form submission to the VendCast support inbox.
 *
 * TO: support@vendcast.co (configured in Cloudflare Email Routing,
 *     forwards to Julian's personal inbox)
 * FROM: the default sending identity (EMAIL_FROM env / hello@vendcast.co)
 * Reply-To: the submitter's email, so Julian can hit Reply in his
 *           inbox and the thread lands back with the user.
 *
 * Intentionally unbranded compared to the operator-facing templates
 * above — this is Julian's inbox, not a customer touchpoint. Includes
 * metadata (user_id, IP, user-agent, UTC + Central timestamps) so
 * Julian has what he needs to respond or investigate abuse.
 */
export async function sendContactFormEmail(payload: ContactFormPayload) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = getResend();

  const subjectLine = `[VendCast Contact] ${payload.subject}: ${payload.name}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="padding:20px 28px;border-bottom:1px solid #f3f4f6;">
      <div style="font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Contact form submission</div>
      <div style="font-size:20px;font-weight:700;color:#111827;margin-top:4px;">${escapeHtml(payload.subject)}</div>
    </div>
    <div style="padding:24px 28px;">
      <table style="width:100%;border-collapse:collapse;">
        <tbody>
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#6b7280;width:110px;vertical-align:top;">From</td>
            <td style="padding:6px 0;font-size:14px;color:#111827;">
              <strong>${escapeHtml(payload.name)}</strong>
              <div style="color:#6b7280;font-size:13px;margin-top:1px;">
                <a href="mailto:${escapeHtml(payload.email)}" style="color:#f97316;text-decoration:none;">${escapeHtml(payload.email)}</a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#6b7280;vertical-align:top;">Subject</td>
            <td style="padding:6px 0;font-size:14px;color:#111827;">${escapeHtml(payload.subject)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#6b7280;vertical-align:top;">Submitted</td>
            <td style="padding:6px 0;font-size:14px;color:#111827;">${escapeHtml(payload.submittedAtCentral)}<br><span style="color:#9ca3af;font-size:12px;">${escapeHtml(payload.submittedAt)}</span></td>
          </tr>
        </tbody>
      </table>
      <div style="background:#f9fafb;border-radius:8px;padding:16px 20px;margin-top:16px;">
        <div style="font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Message</div>
        <div style="font-size:14px;color:#374151;line-height:1.6;white-space:pre-wrap;">${escapeHtml(payload.message)}</div>
      </div>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af;line-height:1.6;">
        <div><strong style="color:#6b7280;">user_id:</strong> ${escapeHtml(payload.userId ?? "(not authenticated)")}</div>
        <div><strong style="color:#6b7280;">ip:</strong> ${escapeHtml(payload.ip ?? "(unknown)")}</div>
        <div style="word-break:break-all;"><strong style="color:#6b7280;">user-agent:</strong> ${escapeHtml(payload.userAgent ?? "(unknown)")}</div>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  await resend.emails.send({
    from: FROM,
    to: "support@vendcast.co",
    replyTo: payload.email,
    subject: subjectLine,
    html,
  });
}

// ─── New-device sign-in notification ────────────────────────────────────────

export interface NewDeviceLoginEmailPayload {
  to: string;
  businessName: string | null;
  /** Pre-formatted "Chrome on macOS" or similar — see summarizeUserAgent. */
  deviceSummary: string;
  /** Pre-formatted "St. Louis, US" or similar — see formatLocation. */
  locationLabel: string;
  /** Full user agent string, surfaced verbatim in case the summary is wrong. */
  userAgent: string;
  ip: string;
  /** ISO timestamp of the login. */
  signedInAt: string;
}

/**
 * Notify the operator when a new (ip, user_agent) combo signs into
 * their account. Operator-acquisition framing (Verdict #25) — the
 * email is reassurance + agency, not alarm. Surfaces a clear
 * "this wasn't me" path to support.
 */
export async function sendNewDeviceLoginEmail(
  payload: NewDeviceLoginEmailPayload
) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = getResend();
  const displayName = payload.businessName || "there";
  const subject = `New sign-in to your VendCast account from ${payload.locationLabel}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#0d4f5c;padding:32px 40px;">
      <div style="color:white;font-size:28px;font-weight:800;letter-spacing:-1px;">VendCast</div>
      <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:6px;">Account security</div>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">New sign-in detected</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
        Hi ${escapeHtml(displayName)} — we noticed a sign-in to your VendCast account from a device or location we haven't seen before.
      </p>
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:20px 0;">
        <tbody>
          <tr><td style="padding:6px 0;font-size:13px;color:#6b7280;width:140px;">Device</td><td style="padding:6px 0;font-size:14px;color:#111827;font-weight:500;">${escapeHtml(payload.deviceSummary)}</td></tr>
          <tr><td style="padding:6px 0;font-size:13px;color:#6b7280;">Location</td><td style="padding:6px 0;font-size:14px;color:#111827;font-weight:500;">${escapeHtml(payload.locationLabel)}</td></tr>
          <tr><td style="padding:6px 0;font-size:13px;color:#6b7280;">IP</td><td style="padding:6px 0;font-size:14px;color:#111827;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(payload.ip)}</td></tr>
          <tr><td style="padding:6px 0;font-size:13px;color:#6b7280;">When</td><td style="padding:6px 0;font-size:14px;color:#111827;">${escapeHtml(payload.signedInAt)}</td></tr>
        </tbody>
      </table>
      <div style="background:#f9fafb;border-radius:8px;padding:14px 18px;margin:20px 0;font-size:12px;color:#6b7280;line-height:1.5;word-break:break-all;">
        <strong style="color:#374151;font-weight:600;">User agent (full):</strong><br/>${escapeHtml(payload.userAgent)}
      </div>
      <p style="margin:24px 0 8px;font-size:15px;color:#111827;font-weight:600;">If this was you</p>
      <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">
        Nothing to do. We'll only email you again when we see another new device.
      </p>
      <p style="margin:24px 0 8px;font-size:15px;color:#111827;font-weight:600;">If this wasn't you</p>
      <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">
        Reset your password immediately at <a href="${APP_URL}/login" style="color:#0d4f5c;">${APP_URL}/login</a>, then email <a href="mailto:support@vendcast.co" style="color:#0d4f5c;">support@vendcast.co</a> so we can lock the account and review activity. We'll respond within one business day.
      </p>
      <p style="margin:32px 0 0;font-size:13px;color:#9ca3af;line-height:1.6;">
        You're receiving this because you have a VendCast account. Login alerts can be turned off from your security settings.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();

  await resend.emails.send({
    from: FROM,
    to: payload.to,
    subject,
    html,
  });
}

// ─── Weekly Digest Email ───────────────────────────────────────────────────

/**
 * Sent every Monday morning to active operators (Pro/Premium with
 * `email_reminders_enabled = true`). 1-paragraph plain-English summary
 * of last week's activity to bring operators back to the dashboard
 * AND demonstrate VendCast is doing background work.
 *
 * Triggered by /api/cron/weekly-digest route. Safe to call with no
 * RESEND_API_KEY (no-op).
 */

export interface WeeklyDigestPayload {
  to: string;
  businessName: string;
  weekRangeLabel: string;          // "April 28 – May 4"
  eventsRun: number;
  totalRevenue: number;
  bestDayCopy: string | null;       // "Saturday outperformed your weekday average by 23%."
  forecastAccuracyPct: number | null; // 91 means 91% in-range; null when no forecast/actual pairs
  unloggedCount: number;            // events past their date with no net_sales logged
  upcomingNextWeek: number;         // booked events Mon-Sun next week
}

export async function sendWeeklyDigestEmail(payload: WeeklyDigestPayload) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = getResend();

  const displayName = payload.businessName || "there";
  const subject = `Your VendCast week — ${escapeHtml(payload.weekRangeLabel)}`;
  const revenueDisplay = `$${Math.round(payload.totalRevenue).toLocaleString("en-US")}`;

  await resend.emails.send({
    from: FROM,
    to: payload.to,
    subject,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">

    <!-- Header -->
    <div style="background:#0d4f5c;padding:32px 40px;">
      <div style="color:white;font-size:28px;font-weight:800;letter-spacing:-1px;">VendCast</div>
      <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:6px;">Your week in review · ${escapeHtml(payload.weekRangeLabel)}</div>
    </div>

    <!-- Body -->
    <div style="padding:40px;">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">Hey ${escapeHtml(displayName)} 👋</h1>

      ${payload.eventsRun > 0 ? `
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#374151;">
        Last week you ran <strong style="color:#0d4f5c;">${payload.eventsRun} event${payload.eventsRun === 1 ? "" : "s"}</strong>, totaling <strong style="color:#0d4f5c;">${revenueDisplay}</strong> in revenue.
      </p>
      ` : `
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#374151;">
        No events ran last week. Time to fill the calendar — your next opportunity is one click away.
      </p>
      `}

      ${payload.bestDayCopy ? `
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <div style="font-size:14px;color:#9a3412;line-height:1.5;">
          📈 ${escapeHtml(payload.bestDayCopy)}
        </div>
      </div>
      ` : ""}

      ${payload.forecastAccuracyPct !== null ? `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#374151;">
        Forecast accuracy this week: <strong>${payload.forecastAccuracyPct}%</strong> in range.
      </p>
      ` : ""}

      ${payload.unloggedCount > 0 ? `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#9a3412;">
        ⚠️ <strong>${payload.unloggedCount} past event${payload.unloggedCount === 1 ? "" : "s"}</strong> still need${payload.unloggedCount === 1 ? "s" : ""} sales logged. Logging them sharpens future forecasts.
      </p>
      ` : ""}

      ${payload.upcomingNextWeek > 0 ? `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#374151;">
        Coming up next week: <strong>${payload.upcomingNextWeek} booked event${payload.upcomingNextWeek === 1 ? "" : "s"}</strong>. Day-of cards are ready when you are.
      </p>
      ` : ""}

      <a href="${APP_URL}/dashboard" style="display:inline-block;background:#0d4f5c;color:white;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;text-decoration:none;margin-top:8px;">
        Open dashboard →
      </a>

      <p style="margin:32px 0 0;font-size:13px;color:#9ca3af;line-height:1.6;">
        You're getting this because email reminders are on for your account. <a href="${APP_URL}/dashboard/settings" style="color:#9ca3af;">Manage preferences</a>.
      </p>
    </div>

    <!-- Footer -->
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">
        VendCast · Built by Wok-O Taco, St. Louis MO
      </p>
    </div>
  </div>
</body>
</html>
    `.trim(),
  });
}

// ─── Event Inquiry Confirmation Email ──────────────────────────────────────

/**
 * Sent to organizers immediately after they submit an event inquiry
 * via the public /request-event form (Phase 7a). Sets honest
 * expectations — operators respond directly via the organizer's email,
 * VendCast doesn't mediate.
 */

export interface EventInquiryConfirmationPayload {
  to: string;
  organizerName: string;
  eventDate: string;       // YYYY-MM-DD
  eventType: string;
  city: string;
  state: string;
  matchedOperatorCount: number;
}

export async function sendEventInquiryConfirmation(p: EventInquiryConfirmationPayload) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = getResend();

  const dateLabel = new Date(p.eventDate + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const opsLine =
    p.matchedOperatorCount === 0
      ? `We don't have any operators in <strong>${escapeHtml(p.city)}, ${escapeHtml(p.state)}</strong> yet — but we're growing fast. We'll save your request and reach out if a match comes online.`
      : p.matchedOperatorCount === 1
        ? `Your request is being shared with <strong>1 operator</strong> in ${escapeHtml(p.city)}, ${escapeHtml(p.state)}. They'll reach out directly via the email you provided if interested.`
        : `Your request is being shared with <strong>${p.matchedOperatorCount} operators</strong> in ${escapeHtml(p.city)}, ${escapeHtml(p.state)}. Any interested operator will reach out directly via the email you provided.`;

  await resend.emails.send({
    from: FROM,
    to: p.to,
    subject: `We received your event request — ${escapeHtml(p.eventType)} on ${dateLabel}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">

    <!-- Header -->
    <div style="background:#0d4f5c;padding:32px 40px;">
      <div style="color:white;font-size:28px;font-weight:800;letter-spacing:-1px;">VendCast</div>
      <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:6px;">Event request received</div>
    </div>

    <!-- Body -->
    <div style="padding:40px;">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">Hi ${escapeHtml(p.organizerName)} 👋</h1>

      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#374151;">
        Thanks for your event request for <strong>${escapeHtml(p.eventType)}</strong> on <strong>${dateLabel}</strong>.
      </p>

      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#374151;">
        ${opsLine}
      </p>

      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <div style="font-weight:600;color:#9a3412;font-size:14px;margin-bottom:8px;">How this works</div>
        <p style="margin:0 0 8px;font-size:14px;color:#374151;line-height:1.5;">
          VendCast doesn't take a commission and doesn't sit between you and the operator. Operators reach out to you directly — you negotiate everything (menu, pricing, logistics) with them.
        </p>
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.5;">
          Most operators respond within 24-48 hours. If you don't hear back from anyone in 3 days, reply to this email and we'll help.
        </p>
      </div>

      <p style="margin:32px 0 0;font-size:13px;color:#9ca3af;line-height:1.6;">
        Questions? Just reply — it goes to a real human.
      </p>
    </div>

    <!-- Footer -->
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">
        VendCast · Built by Wok-O Taco, St. Louis MO
      </p>
    </div>
  </div>
</body>
</html>
    `.trim(),
  });
}
