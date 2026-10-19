import { NextResponse } from "next/server";

import { getRootLogger } from "@/server/logging";
import { NcpReinitialiseError } from "@/server/monitoring";
import { getAppRuntime } from "@/server/runtime/app-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ deviceId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { deviceId } = await context.params;
  const log = getRootLogger().child({
    component: "api-device-reinitialise",
    deviceId,
  });
  const app = getAppRuntime();
  await app.ensureStarted();
  const ncp = app.getNcp();
  if (!ncp) {
    log.error("Monitoring runtime is not available");
    return NextResponse.json(
      { error: "Monitoring runtime is not available" },
      { status: 503 },
    );
  }

  try {
    await ncp.reinitialiseDevice(deviceId);
    return NextResponse.json({ ok: true, deviceId });
  } catch (error) {
    const status = error instanceof NcpReinitialiseError ? error.status : 500;
    log.error({ err: error }, "Device reinitialise failed");
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Device reinitialise failed",
      },
      { status },
    );
  }
}
