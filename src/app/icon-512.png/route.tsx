import { ImageResponse } from "next/og";

export const runtime = "edge";

// TODO: Replace with Brad Hatton brand system when ready.
// Interim lettermark — single bold "V" on orange matches the "Mobile app"
// vibe of the mobile header without inventing new identity.
//
// See icon-192.png/route.tsx for Satori flex-warning notes — same fix
// applied here (collapsed the nested styled <div> into the outer flex
// container).
export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 512,
          height: 512,
          background: "#f97316",
          borderRadius: 80,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: 320,
          fontWeight: 800,
          letterSpacing: -12,
          lineHeight: 1,
        }}
      >
        V
      </div>
    ),
    { width: 512, height: 512 }
  );
}
