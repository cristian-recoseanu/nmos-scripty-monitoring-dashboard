import { NextResponse } from "next/server";

import { getRootLogger } from "@/server/logging";
import { getAppRuntime } from "@/server/runtime/app-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ deviceId: string; oid: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { deviceId, oid: oidRaw } = await context.params;
  const log = getRootLogger().child({
    component: "api-monitor-auto-reset",
    deviceId,
    oid: oidRaw,
  });
  const oid = Number(oidRaw);
  if (!Number.isInteger(oid)) {
    log.warn("Invalid oid for auto-reset");
    return NextResponse.json({ error: "Invalid oid" }, { status: 400 });
  }

  let body: { value?: unknown };
  try {
    body = (await request.json()) as { value?: unknown };
  } catch (error) {
    log.warn({ err: error }, "Invalid JSON body for auto-reset");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.value !== "boolean") {
    log.warn({ body }, "auto-reset body missing boolean value");
    return NextResponse.json(
      { error: "Body must include boolean value" },
      { status: 400 },
    );
  }

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
    await ncp.setAutoReset(deviceId, oid, body.value);
    return NextResponse.json({ ok: true, value: body.value });
  } catch (error) {
    log.error({ err: error, oid, value: body.value }, "Failed to set autoReset");
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to set autoReset",
      },
      { status: 502 },
    );
  }
}
