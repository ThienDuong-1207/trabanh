import { NextRequest, NextResponse } from "next/server";
import { syncFromGoogleSheet } from "@/lib/googleSheetSync";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await syncFromGoogleSheet();
    return NextResponse.json(summary);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
