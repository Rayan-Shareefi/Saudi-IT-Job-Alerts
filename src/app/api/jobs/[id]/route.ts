import { NextResponse } from "next/server";
import { supabaseRead } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * One posting's full text and evidence, loaded when a card is opened.
 *
 * The list never carries descriptions - a few hundred full postings would
 * make the page megabytes - so the detail view asks for one at a time.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  const { data, error } = await supabaseRead()
    .from("jobs")
    .select("id,title,company,description_text,location_text,employment_type,department,experience_evidence,scope_evidence,decision_note,decided_by,text_quality,text_fetched_at,url,apply_url")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, job: data });
}
