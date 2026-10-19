import { NextResponse } from "next/server";

import { getRootLogger } from "@/server/logging";
import { NcpReinitialiseError } from "@/server/monitoring";
import { getAppRuntime } from "@/server/runtime/app-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ nodeId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { nodeId } = await context.params;
  const log = getRootLogger().child({
    component: "api-node-reinitialise",
    nodeId,
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
    const result = await ncp.reinitialiseNode(nodeId);
    if (result.failures.length > 0) {
      log.warn(result, "Node reinitialise completed with failures");
    }
    return NextResponse.json({
      ok: result.failures.length === 0,
      nodeId,
      ...result,
    });
  } catch (error) {
    const status = error instanceof NcpReinitialiseError ? error.status : 500;
    log.error({ err: error }, "Node reinitialise failed");
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Node reinitialise failed",
      },
      { status },
    );
  }
}
