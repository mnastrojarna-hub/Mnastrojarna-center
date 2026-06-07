import { NextResponse } from "next/server";
import { syncMailbox } from "@/lib/email/ingest";

// IMAP klient vyžaduje Node runtime
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const result = await syncMailbox(20);
  return NextResponse.json(result);
}
