import { ImageResponse } from "next/og";

export const runtime = "edge";

// TODO: Replace with Brad Hatton brand system when ready.
// Interim lettermark — single bold "V" on orange matches the "Mobile app"
// vibe of the mobile header without inventing new identity.
export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 192,
          height: 192,
          background: "#f97316",
          borderRadius: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            color: "white",
            fontSize: 120,
            fontWeight: 800,
            letterSpacing: -4,
            lineHeight: 1,
          }}
        >
          V
        </div>
      </div>
    ),
    { width: 192, height: 192 }
  );
}
