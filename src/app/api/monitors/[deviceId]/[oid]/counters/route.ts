import { NextResponse } from "next/server";

import { getAppRuntime } from "@/server/runtime/app-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ deviceId: string; oid: string }>;
};

const COUNTER_TYPES = new Set(["lost", "late", "transmission"]);

export async function GET(request: Request, context: RouteContext) {
  const { deviceId, oid: oidRaw } = await context.params;
  const oid = Number(oidRaw);
  if (!Number.isInteger(oid)) {
    return NextResponse.json({ error: "Invalid oid" }, { status: 400 });
  }

  const type = new URL(request.url).searchParams.get("type");
  if (!type || !COUNTER_TYPES.has(type)) {
    return NextResponse.json(
      { error: "Query param type must be lost, late, or transmission" },
      { status: 400 },
    );
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
    const result =
      type === "lost"
        ? await ncp.getLostPackets(deviceId, oid)
        : type === "late"
          ? await ncp.getLatePackets(deviceId, oid)
          : await ncp.getTransmissionErrors(deviceId, oid);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Counter fetch failed";
    const status = message.includes("throttled") ? 429 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
