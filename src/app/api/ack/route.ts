import { NextResponse } from "next/server";

import type { AckableKind } from "@/server/domain/acknowledgement-store";
import { getRootLogger } from "@/server/logging";
import { getAppRuntime } from "@/server/runtime/app-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACKABLE = new Set<AckableKind>(["node", "device", "sender", "receiver"]);

export async function POST(request: Request) {
  const log = getRootLogger().child({ component: "api-ack" });

  let body: { kind?: unknown; id?: unknown; acknowledged?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch (error) {
    log.warn({ err: error }, "Invalid JSON body for acknowledgement");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const kind = body.kind;
  const id = body.id;
  const acknowledged = body.acknowledged;

  if (typeof kind !== "string" || !ACKABLE.has(kind as AckableKind)) {
    log.warn({ kind }, "Invalid acknowledgement kind");
    return NextResponse.json(
      { error: "kind must be node, device, sender, or receiver" },
      { status: 400 },
    );
  }
  if (typeof id !== "string" || id.trim() === "") {
    log.warn({ id }, "Invalid acknowledgement id");
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (typeof acknowledged !== "boolean") {
    log.warn({ acknowledged }, "Invalid acknowledgement value");
    return NextResponse.json(
      { error: "acknowledged must be a boolean" },
      { status: 400 },
    );
  }

  try {
    const app = getAppRuntime();
    await app.ensureStarted();
    app.setAcknowledgement(kind as AckableKind, id, acknowledged);
    return NextResponse.json({ ok: true, kind, id, acknowledged });
  } catch (error) {
    log.error({ err: error, kind, id, acknowledged }, "Failed to set acknowledgement");
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to set acknowledgement",
      },
      { status: 500 },
    );
  }
}
