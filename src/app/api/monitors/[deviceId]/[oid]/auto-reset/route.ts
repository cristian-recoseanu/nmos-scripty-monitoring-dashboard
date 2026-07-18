import { NextResponse } from "next/server";

import { getAppRuntime } from "@/server/runtime/app-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ deviceId: string; oid: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { deviceId, oid: oidRaw } = await context.params;
  const oid = Number(oidRaw);
  if (!Number.isInteger(oid)) {
    return NextResponse.json({ error: "Invalid oid" }, { status: 400 });
  }

  let body: { value?: unknown };
  try {
    body = (await request.json()) as { value?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.value !== "boolean") {
    return NextResponse.json(
      { error: "Body must include boolean value" },
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
    await ncp.setAutoReset(deviceId, oid, body.value);
    return NextResponse.json({ ok: true, value: body.value });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to set autoReset",
      },
      { status: 502 },
    );
  }
}
