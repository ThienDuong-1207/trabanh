import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { resolveBrandId } from "@/lib/brands";
import { ProductInput } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { brand, ...fields } = (await req.json()) as ProductInput;

    const supabase = supabaseAdmin();
    const brand_id = await resolveBrandId(supabase, brand);

    const { data, error } = await supabase
      .from("products")
      .update({ ...fields, brand_id })
      .eq("id", params.id)
      .select("*, brand:brands(name)")
      .single();
    if (error) throw error;

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = supabaseAdmin();
    const { error } = await supabase.from("products").delete().eq("id", params.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
