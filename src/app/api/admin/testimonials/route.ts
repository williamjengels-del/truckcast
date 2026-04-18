import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminUser } from "@/lib/admin";

async function getAdminServiceClient() {
  if (!(await getAdminUser())) return null;
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const serviceClient = await getAdminServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await serviceClient
    .from("testimonials")
    .select("*")
    .order("display_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ testimonials: data ?? [] });
}

export async function POST(request: NextRequest) {
  const serviceClient = await getAdminServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { author_name, author_title, content, rating, display_order } = body;

  if (!author_name || !content) {
    return NextResponse.json({ error: "author_name and content are required" }, { status: 400 });
  }

  const { data, error } = await serviceClient
    .from("testimonials")
    .insert({
      author_name,
      author_title: author_title ?? null,
      content,
      rating: rating ?? 5,
      display_order: display_order ?? 0,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ testimonial: data });
}
