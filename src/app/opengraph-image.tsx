import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "VendCast — Event Forecasting for Food Trucks & Mobile Vendors";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Subtle grid lines */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(99,102,241,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.07) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        {/* Glow */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 700,
            height: 400,
            background: "radial-gradient(ellipse, rgba(99,102,241,0.18) 0%, transparent 70%)",
            borderRadius: "50%",
          }}
        />

        {/* Logo row */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
          <div
            style={{
              width: 56,
              height: 56,
              background: "#6366f1",
              borderRadius: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
            }}
          >
            🚚
          </div>
          <span style={{ fontSize: 38, fontWeight: 800, color: "#fff", letterSpacing: -1 }}>
            VendCast
          </span>
        </div>

        {/* Headline */}
        {/* display: "contents" satisfies Satori's multi-child-div rule
            without altering layout. The children here are text + span
            + text (flowing inline text with a mid-phrase color
            highlight), so flex would require retrofitting flexWrap +
            justifyContent to preserve the original appearance. Because
            Satori accepts "contents" and it's invisible to layout, use
            it — zero visual risk. See df6ace3 for the earlier Satori
            fix on the icon routes that used the flex approach. */}
        <div
          style={{
            display: "contents",
            fontSize: 58,
            fontWeight: 800,
            color: "#fff",
            textAlign: "center",
            lineHeight: 1.1,
            letterSpacing: -2,
            maxWidth: 900,
            marginBottom: 24,
          }}
        >
          Know what your next event{" "}
          <span style={{ color: "#818cf8" }}>will make</span>
          {" "}before you book it.
        </div>

        {/* Subline */}
        <div
          style={{
            fontSize: 24,
            color: "#94a3b8",
            textAlign: "center",
            maxWidth: 700,
            lineHeight: 1.4,
            marginBottom: 48,
          }}
        >
          Event forecasting, POS sync, and performance analytics — built for food trucks & mobile vendors.
        </div>

        {/* Pill badges */}
        <div style={{ display: "flex", gap: 16 }}>
          {["14-Day Free Trial", "No Credit Card", "Built by a Food Truck Owner"].map((label) => (
            <div
              key={label}
              style={{
                background: "rgba(99,102,241,0.15)",
                border: "1px solid rgba(99,102,241,0.4)",
                borderRadius: 999,
                padding: "10px 22px",
                fontSize: 16,
                color: "#c7d2fe",
                fontWeight: 600,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
