import { ImageResponse } from "next/og";

export const runtime = "edge";

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
            fontSize: 72,
            fontWeight: 800,
            letterSpacing: -2,
            lineHeight: 1,
          }}
        >
          TC
        </div>
      </div>
    ),
    { width: 192, height: 192 }
  );
}
