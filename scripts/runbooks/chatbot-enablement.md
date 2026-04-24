# Runbook — Chatbot enablement (Tier-A)

**Flagged in:** v10 / v11 (`Tier-A chatbot (needs ANTHROPIC_API_KEY on Vercel + rate limiting)`).

**What it is:** a documented procedure for turning the already-built AI chat assistant from dormant (503 responses, hidden widget) to live (Pro/Premium users see a floating chat panel, questions are answered against their own events + performance data).

---

## State of the code (audit, 2026-04-24)

### Shipped and ready

| Piece | File | What it does |
|---|---|---|
| Chat API | `src/app/api/chat/route.ts` | POST, auth-gated, Pro/Premium tier gate, rate-limited (20 msg / user / hour), streams Anthropic Claude Haiku response with the user's last 100 events + top 10 performance rows as system-prompt context. Sentry on errors. |
| Chat Widget | `src/components/chat-widget.tsx` | Floating bottom-right button + slide-up panel, streams assistant messages, shows an upgrade gate for Starter users. |
| Layout gate | `src/app/dashboard/layout.tsx:44` | `chatEnabled = Boolean(process.env.ANTHROPIC_API_KEY)` — widget renders only when the env var is present. |
| Anthropic SDK | `package.json` | `@anthropic-ai/sdk ^0.88.0` |

### NOT shipped (first-stage gaps)

| Gap | Status |
|---|---|
| `ANTHROPIC_API_KEY` on Vercel | Missing — this runbook covers that |
| Per-user rate limit | **Landed in PR this runbook ships with** (20 msg / hour via `src/lib/rate-limit.ts`) |
| Sentry error capture on API failures | **Landed in same PR** |
| Token-usage tracking | Deferred — low priority until there's real usage to track |
| Tier-B chatbot (tool-calling, data Q&A without hardcoded context) | Separate L-scale workstream in v11 queue |
| Pre-response safety check / content filter | Deferred — Anthropic's default safety is sufficient for the narrow business-data domain |
| Conversation history / persistence | Deferred — current UX is stateless per panel-open, which is fine for quick-question use case |

---

## Enablement procedure

### Step 1 — add the API key to Vercel

1. **Get an Anthropic API key** at https://console.anthropic.com → Settings → API Keys → Create Key. Name it `vendcast-prod`. Copy the value.
2. **Set a usage cap** on the key while you're there. Cost ceiling suggestion: $50/month for the first 30 days. Adjust based on actual use.
3. **Add to Vercel**: https://vercel.com/williamjengels-3711s-projects/truckcast → **Settings → Environment Variables** → **Add**:
   - Key: `ANTHROPIC_API_KEY`
   - Value: the key from step 1
   - Environments: **Production + Preview + Development**
4. **Redeploy**: trigger a new deploy via `vercel redeploy` or push any commit. `/api/version` should show the fresh deploy.
5. **Verify**: on vendcast.co, sign in as a Pro/Premium user → chat widget button appears bottom-right → open → ask a question → streaming answer appears. As a Starter user the button also appears but the panel shows an upgrade gate.

### Step 2 — monitor the first week

- Sentry: filter by `tags.source == "chat_api"`. Any Anthropic-side failures (rate limit on OUR key, auth errors) surface here.
- Anthropic console: watch the usage dashboard. If usage is trivial, raise the rate limit; if usage surprises, lower it.
- Rate-limit responses (429s) aren't captured in Sentry by design — legit users hitting the limit isn't an error. If you want visibility, grep Vercel logs for `"Rate limit reached"` via `vercel logs`.

### Step 3 — if things go wrong

- **Unplug immediately**: delete `ANTHROPIC_API_KEY` from Vercel env. The widget re-hides automatically on the next page load (the `chatEnabled` check at layout.tsx:44 is re-evaluated per request).
- **Roll back a bad response**: there's no stored conversation history, so there's nothing to clean up. Just unplug.

---

## What this runbook does NOT cover

- **Tier-B chatbot** (tool-calling, ability to run arbitrary queries against the operator's data) — separate workstream, needs its own scoping, safety review, and rollout plan.
- **Multi-turn conversation memory** — the current UX is stateless; each panel-open starts fresh.
- **Admin-side analytics** (how many messages/week, per-tier usage distribution) — not built. If operationally useful later, land a `chat_usage_log` table + an admin chart.
