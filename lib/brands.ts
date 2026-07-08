import { SupabaseClient } from "@supabase/supabase-js";

// Resolves a free-typed brand name to its brands.id, creating the row if it
// doesn't exist yet (brand and supplier are treated as the same entity — see
// supabase/schema.sql).
export async function resolveBrandId(supabase: SupabaseClient, name: string | null | undefined): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;

  const { data: existing, error: findError } = await supabase.from("brands").select("id").eq("name", trimmed).maybeSingle();
  if (findError) throw new Error(`Không tìm được thương hiệu: ${findError.message}`);
  if (existing) return existing.id as string;

  const { data: created, error: createError } = await supabase.from("brands").insert({ name: trimmed }).select("id").single();
  if (createError) throw new Error(`Không tạo được thương hiệu: ${createError.message}`);
  return created.id as string;
}
