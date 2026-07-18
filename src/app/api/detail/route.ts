import { NextResponse } from "next/server";

import type { EntityKind } from "@/server/domain";
import { getAppRuntime } from "@/server/runtime/app-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KINDS = new Set<EntityKind>([
  "system",
  "node",
  "device",
  "sender",
  "receiver",
]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as EntityKind | null;
  const id = url.searchParams.get("id");

  if (!kind || !KINDS.has(kind) || !id) {
    return NextResponse.json(
      { error: "Query params kind and id are required" },
      { status: 400 },
    );
  }

  const app = getAppRuntime();
  await app.ensureStarted();
  const detail = app.getDetail(kind, id);
  if (!detail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
