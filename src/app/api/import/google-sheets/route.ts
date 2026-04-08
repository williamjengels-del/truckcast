import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/import/google-sheets?url=<encoded-google-sheets-url>
 *
 * Server-side proxy that fetches a publicly shared Google Sheet as CSV.
 * Runs server-side to avoid CORS issues when fetching from Google's servers.
 *
 * The sheet must be shared as "Anyone with the link can view".
 *
 * Supports URLs in these formats:
 *   https://docs.google.com/spreadsheets/d/{ID}/edit#gid={GID}
 *   https://docs.google.com/spreadsheets/d/{ID}/edit?usp=sharing
 *   https://docs.google.com/spreadsheets/d/{ID}/pub?...
 */
export async function GET(req: NextRequest) {
  // Must be authenticated
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Extract sheet ID and gid from the URL
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) {
    return NextResponse.json(
      { error: "Invalid Google Sheets URL. Make sure you copied the full URL from your browser." },
      { status: 400 }
    );
  }

  const sheetId = idMatch[1];
  const gidMatch = url.match(/[#&?]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";

  // Construct the CSV export URL
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

  try {
    const res = await fetch(csvUrl, {
      headers: {
        // Identify ourselves politely
        "User-Agent": "TruckCast/1.0 (import tool)",
      },
      // 10 second timeout
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json(
        {
          error:
            'Sheet is not publicly accessible. In Google Sheets, click Share → change to "Anyone with the link can view", then try again.',
        },
        { status: 403 }
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `Google returned an error (${res.status}). Check the URL and try again.` },
        { status: 502 }
      );
    }

    const contentType = res.headers.get("content-type") ?? "";
    // Google redirects to a login page (HTML) if the sheet is private
    if (contentType.includes("text/html")) {
      return NextResponse.json(
        {
          error:
            'Sheet is not publicly accessible. In Google Sheets, click Share → change to "Anyone with the link can view", then try again.',
        },
        { status: 403 }
      );
    }

    const csv = await res.text();
    if (!csv.trim()) {
      return NextResponse.json(
        { error: "The sheet appears to be empty." },
        { status: 422 }
      );
    }

    return new NextResponse(csv, {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Google Sheets took too long to respond. Try again in a moment." },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: "Failed to fetch the sheet. Check the URL and your sharing settings." },
      { status: 502 }
    );
  }
}
