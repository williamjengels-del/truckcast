import { ImageResponse } from "next/og";

export const runtime = "edge";

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
          flexDirection: "column",
        }}
      >
        <div
          style={{
            color: "white",
            fontSize: 192,
            fontWeight: 800,
            letterSpacing: -6,
            lineHeight: 1,
          }}
        >
          TC
        </div>
      </div>
    ),
    { width: 512, height: 512 }
  );
}
