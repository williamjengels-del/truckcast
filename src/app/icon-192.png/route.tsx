import { ImageResponse } from "next/og";

export const runtime = "edge";

// TODO: Replace with Brad Hatton brand system when ready.
// Interim lettermark — single bold "V" on orange matches the "Mobile app"
// vibe of the mobile header without inventing new identity.
//
// Structural note: Satori (the renderer inside ImageResponse) emits a
// warning when a <div> has more than one child node without an explicit
// `display` set to flex / contents / none. The previous version nested
// a styled <div> inside the flex container, which is enough to trip the
// check on some code paths even though the tree looks single-child in
// JSX. Flattening to one <div> with text removes the ambiguity and the
// outer flex was already doing all the centering work anyway.
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
          color: "white",
          fontSize: 120,
          fontWeight: 800,
          letterSpacing: -4,
          lineHeight: 1,
        }}
      >
        V
      </div>
    ),
    { width: 192, height: 192 }
  );
}
