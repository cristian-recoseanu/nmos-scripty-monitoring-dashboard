import { NextResponse } from "next/server";

import { getRootLogger } from "@/server/logging";
import { getAppRuntime } from "@/server/runtime/app-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const log = getRootLogger().child({ component: "api-system-reset-monitors" });
  const app = getAppRuntime();
  await app.ensureStarted();
  const ncp = app.getNcp();
  if (!ncp) {
    log.error("Monitoring runtime is not available for system-wide reset");
    return NextResponse.json(
      { error: "Monitoring runtime is not available" },
      { status: 503 },
    );
  }

  try {
    const result = await ncp.resetAllMonitors();
    if (result.failures.length > 0) {
      log.warn(
        {
          reset: result.reset,
          skipped: result.skipped,
          failures: result.failures,
        },
        "System-wide monitor reset completed with failures",
      );
    }
    return NextResponse.json({
      ok: result.failures.length === 0,
      ...result,
    });
  } catch (error) {
    log.error({ err: error }, "System-wide monitor reset failed");
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
