import { NextResponse } from "next/server";

import { getAppRuntime } from "@/server/runtime/app-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const app = getAppRuntime();
  await app.ensureStarted();
  const ncp = app.getNcp();
  if (!ncp) {
    return NextResponse.json(
      { error: "Monitoring runtime is not available" },
      { status: 503 },
    );
  }

  try {
    const result = await ncp.resetAllMonitors();
    return NextResponse.json({
      ok: result.failures.length === 0,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "System-wide monitor reset failed",
      },
      { status: 500 },
    );
  }
}
