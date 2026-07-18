import type { Logger } from "@/server/logging";
import { childLogger } from "@/server/logging";
import { PROP_TOUCHPOINTS, type Is12Session, type NcOid } from "@/server/is12";

export type NmosTouchpointResource = {
  resourceType: string;
  id: string;
};

export type NmosTouchpoint = {
  contextNamespace: string;
  resource: NmosTouchpointResource;
};

export type MonitorTouchpointLink = {
  monitorOid: NcOid;
  resourceType: "sender" | "receiver";
  resourceId: string;
};

export class TouchpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TouchpointError";
  }
}

function isNmosTouchpoint(value: unknown): value is NmosTouchpoint {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const entry = value as NmosTouchpoint;
  return (
    entry.contextNamespace === "x-nmos" &&
    entry.resource !== null &&
    typeof entry.resource === "object" &&
    typeof entry.resource.resourceType === "string" &&
    typeof entry.resource.id === "string"
  );
}

/**
 * Extract the NMOS sender/receiver touchpoint from a monitor's touchpoints property.
 */
export function parseMonitorTouchpoint(
  touchpoints: unknown,
  expectedKind?: "sender" | "receiver",
): { resourceType: "sender" | "receiver"; resourceId: string } {
  if (!Array.isArray(touchpoints) || touchpoints.length === 0) {
    throw new TouchpointError("Monitor has no touchpoints");
  }

  const nmosTouchpoints = touchpoints.filter(isNmosTouchpoint);
  if (nmosTouchpoints.length === 0) {
    throw new TouchpointError("Monitor has no x-nmos touchpoint");
  }

  const match = nmosTouchpoints.find((tp) => {
    const type = tp.resource.resourceType.toLowerCase();
    if (expectedKind) {
      return type === expectedKind;
    }
    return type === "sender" || type === "receiver";
  });

  if (!match) {
    throw new TouchpointError(
      expectedKind
        ? `Monitor has no NMOS touchpoint for resourceType "${expectedKind}"`
        : "Monitor has no sender/receiver NMOS touchpoint",
    );
  }

  const resourceType = match.resource.resourceType.toLowerCase();
  if (resourceType !== "sender" && resourceType !== "receiver") {
    throw new TouchpointError(
      `Unexpected NMOS touchpoint resourceType: ${match.resource.resourceType}`,
    );
  }

  return {
    resourceType,
    resourceId: match.resource.id,
  };
}

export async function resolveMonitorTouchpoint(
  session: Is12Session,
  monitorOid: NcOid,
  expectedKind: "sender" | "receiver",
  logger: Logger,
): Promise<MonitorTouchpointLink> {
  const log = childLogger(logger, {
    component: "touchpoints",
    resourceId: String(monitorOid),
  });

  const touchpoints = await session.getProperty(monitorOid, PROP_TOUCHPOINTS);
  try {
    const parsed = parseMonitorTouchpoint(touchpoints, expectedKind);
    if (parsed.resourceType !== expectedKind) {
      log.warn(
        {
          expectedKind,
          actual: parsed.resourceType,
          resourceId: parsed.resourceId,
        },
        "Touchpoint resourceType does not match monitor kind",
      );
    }
    return {
      monitorOid,
      resourceType: parsed.resourceType,
      resourceId: parsed.resourceId,
    };
  } catch (error) {
    log.warn({ err: error, monitorOid }, "Failed to resolve monitor touchpoint");
    throw error;
  }
}
