import { NextResponse } from "next/server";

import { getAppRuntime } from "@/server/runtime/app-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const app = getAppRuntime();
  await app.ensureStarted();
  return NextResponse.json(app.getSnapshot());
}
