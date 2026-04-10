export const dynamic = "force-dynamic";
import { createClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function formatTime(time: string | null): string {
  if (!time) return "";
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}:${m} ${ampm}`;
}

function formatDate(dateStr: string): { dayOfWeek: string; monthDay: string } {
  const date = new Date(dateStr + "T00:00:00");
  const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "short" });
  const monthDay = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return { dayOfWeek, monthDay };
}

export default async function EmbedSchedulePage({ params, searchParams }: PageProps) {
  const { userId } = await params;
  const query = await searchParams;

  const theme = query.theme === "dark" ? "dark" : "light";
  const limit = Math.min(Math.max(parseInt(String(query.limit ?? "20"), 10) || 20, 1), 50);
  const showHeader = query.header !== "false";
  const accentRaw = typeof query.accent === "string" ? query.accent.replace(/[^a-fA-F0-9]/g, "") : "";
  const accent = accentRaw.length >= 3 ? `#${accentRaw}` : "#4f46e5";

  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name, city, state, subscription_tier")
    .eq("id", userId)
    .single();

  if (!profile) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#6b7280" }}>Schedule not found.</p>
      </div>
    );
  }

  if (profile.subscription_tier === "starter") {
    return (
      <div style={{ padding: "2rem", textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>
          Upgrade to Pro to embed your schedule.
        </p>
        <a
          href="https://truckcast.app"
          style={{ color: accent, fontSize: "0.75rem", textDecoration: "none" }}
        >
          Powered by TruckCast
        </a>
      </div>
    );
  }

  const today = new Date().toISOString().split("T")[0];

  const { data: events } = await supabase
    .from("events")
    .select("event_name, event_date, start_time, end_time, location, city, event_type")
    .eq("user_id", userId)
    .eq("booked", true)
    .neq("is_private", true)
    .gte("event_date", today)
    .order("event_date", { ascending: true })
    .limit(limit);

  const isDark = theme === "dark";
  const bg = isDark ? "#1a1a2e" : "#ffffff";
  const textPrimary = isDark ? "#f1f5f9" : "#1e293b";
  const textSecondary = isDark ? "#94a3b8" : "#64748b";
  const cardBg = isDark ? "#16213e" : "#f8fafc";
  const borderColor = isDark ? "#334155" : "#e2e8f0";

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        backgroundColor: bg,
        color: textPrimary,
        padding: "1rem",
        minHeight: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
      }}
    >
      {showHeader && profile.business_name && (
        <div style={{ marginBottom: "1rem", paddingBottom: "0.75rem", borderBottom: `2px solid ${accent}` }}>
          <h1
            style={{
              fontSize: "1.125rem",
              fontWeight: 700,
              margin: 0,
              color: textPrimary,
            }}
          >
            {profile.business_name}
          </h1>
          {(profile.city || profile.state) && (
            <p style={{ fontSize: "0.8125rem", margin: "0.25rem 0 0", color: textSecondary }}>
              {[profile.city, profile.state].filter(Boolean).join(", ")}
            </p>
          )}
        </div>
      )}

      {!events || events.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: textSecondary, textAlign: "center", padding: "2rem 0" }}>
          No upcoming events scheduled.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {events.map((event, i) => {
            const { dayOfWeek, monthDay } = formatDate(event.event_date);
            const timeRange =
              event.start_time || event.end_time
                ? [formatTime(event.start_time), formatTime(event.end_time)].filter(Boolean).join(" - ")
                : null;
            const locationStr = [event.location, event.city].filter(Boolean).join(", ");

            return (
              <div
                key={`${event.event_date}-${event.event_name}-${i}`}
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  padding: "0.75rem",
                  backgroundColor: cardBg,
                  borderRadius: "0.5rem",
                  border: `1px solid ${borderColor}`,
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    minWidth: "3.25rem",
                    textAlign: "center",
                    flexShrink: 0,
                  }}
                >
                  <div style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", color: accent }}>
                    {dayOfWeek}
                  </div>
                  <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: textPrimary }}>
                    {monthDay}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      color: textPrimary,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {event.event_name}
                  </div>
                  {timeRange && (
                    <div style={{ fontSize: "0.75rem", color: textSecondary, marginTop: "0.125rem" }}>
                      {timeRange}
                    </div>
                  )}
                  {locationStr && (
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: textSecondary,
                        marginTop: "0.125rem",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {locationStr}
                    </div>
                  )}
                </div>
                {event.event_type && (
                  <span
                    style={{
                      fontSize: "0.625rem",
                      padding: "0.125rem 0.375rem",
                      borderRadius: "9999px",
                      backgroundColor: `${accent}20`,
                      color: accent,
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      alignSelf: "center",
                    }}
                  >
                    {event.event_type}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: "1rem", textAlign: "center", paddingTop: "0.5rem" }}>
        <a
          href="https://truckcast.app"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: "0.6875rem",
            color: textSecondary,
            textDecoration: "none",
          }}
        >
          Powered by TruckCast
        </a>
      </div>
    </div>
  );
}
