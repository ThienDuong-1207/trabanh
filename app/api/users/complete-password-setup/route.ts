import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { createServerSupabase } from "@/lib/supabaseServerClient";

export const runtime = "nodejs";

// Called right after the user successfully sets their own new password
// (app/set-password/page.tsx) — clears the forced-reset flag. Only needs a
// valid session, not a specific role: everyone must be able to clear their
// own flag regardless of what role Admin assigned them.
export async function POST() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const { error } = await supabaseAdmin().from("profiles").update({ must_change_password: false }).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
