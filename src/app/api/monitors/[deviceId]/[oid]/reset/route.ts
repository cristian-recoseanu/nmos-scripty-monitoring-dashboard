import { NextResponse } from "next/server";

import { getAppRuntime } from "@/server/runtime/app-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ deviceId: string; oid: string }>;
};

function parseOid(raw: string): number | undefined {
  const oid = Number(raw);
  return Number.isInteger(oid) ? oid : undefined;
}

export async function POST(_request: Request, context: RouteContext) {
  const { deviceId, oid: oidRaw } = await context.params;
  const oid = parseOid(oidRaw);
  if (oid === undefined) {
    return NextResponse.json({ error: "Invalid oid" }, { status: 400 });
  }

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
    await ncp.resetMonitor(deviceId, oid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Reset failed",
      },
      { status: 502 },
    );
  }
}
