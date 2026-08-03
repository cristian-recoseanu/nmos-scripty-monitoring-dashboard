import type { HealthSeverity } from "@/lib/health";
import type {
  DeviceHealth,
  LeafHealth,
  NodeHealth,
  SystemHealth,
} from "@/server/domain/health-aggregator";
import type { Is05DetailDto } from "@/server/is05/types";
import type { MonitorDetailDto } from "@/server/domain/snapshot";

export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 500;

export type CompactLeafRow = {
  kind: "sender" | "receiver";
  id: string;
  label: string;
  health: HealthSeverity;
  totalTransitions: number;
  deviceId: string;
  nodeId?: string;
  format: string;
  hasMonitor: boolean;
  acknowledged: boolean;
  connectedPeerId?: string | null;
  message?: string | null;
};

export type ProblemRow = {
  kind: "node" | "device" | "sender" | "receiver";
  id: string;
  label: string;
  health: HealthSeverity;
  message?: string | null;
  acknowledged: boolean;
  nodeId?: string;
  deviceId?: string;
  hasMonitor?: boolean;
};

export type BudgetedIs05 = Omit<Is05DetailDto, "transportFile" | "active"> & {
  active?: Record<string, unknown>;
  transportFile?: {
    contentType: string;
    byteLength: number;
    included: boolean;
    data?: string;
  } | null;
};

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(limit)));
}

/** Strip/omit large SDP payloads unless explicitly requested. */
export function budgetIs05(
  is05: Is05DetailDto | undefined,
  includeTransportFile: boolean,
): BudgetedIs05 | undefined {
  if (!is05) {
    return undefined;
  }

  const active = is05.active
    ? (JSON.parse(JSON.stringify(is05.active)) as Record<string, unknown>)
    : undefined;
  if (active && "transport_file" in active) {
    const tf = active.transport_file as
      | { data?: string | null; type?: string | null }
      | undefined;
    if (tf && typeof tf === "object") {
      const data = typeof tf.data === "string" ? tf.data : null;
      active.transport_file = {
        type: tf.type ?? null,
        data: includeTransportFile ? data : null,
        byteLength: data?.length ?? 0,
        included: includeTransportFile && Boolean(data),
      };
    }
  }

  const file = is05.transportFile;
  const transportFile = file
    ? {
        contentType: file.contentType,
        byteLength: file.data.length,
        included: includeTransportFile,
        ...(includeTransportFile ? { data: file.data } : {}),
      }
    : (file ?? null);

  return {
    status: is05.status,
    connectionApiHref: is05.connectionApiHref,
    active,
    transportFile,
    fetchedAt: is05.fetchedAt,
    sourceIs04Version: is05.sourceIs04Version,
    error: is05.error,
  };
}

export function budgetMonitor(
  monitor: MonitorDetailDto | undefined,
): MonitorDetailDto | undefined {
  return monitor;
}

export function walkLeaves(
  system: SystemHealth,
): Array<{
  leaf: LeafHealth;
  device: DeviceHealth;
  node: NodeHealth;
}> {
  const rows: Array<{
    leaf: LeafHealth;
    device: DeviceHealth;
    node: NodeHealth;
  }> = [];
  for (const node of system.nodes) {
    for (const device of node.devices) {
      for (const leaf of [...device.senders, ...device.receivers]) {
        rows.push({ leaf, device, node });
      }
    }
  }
  return rows;
}

export function collectProblems(
  system: SystemHealth,
  options: {
    nodeId?: string;
    deviceId?: string;
    includeUnknownWithoutMonitor?: boolean;
    isAcknowledged: (kind: ProblemRow["kind"], id: string) => boolean;
  },
): ProblemRow[] {
  const problems: ProblemRow[] = [];
  const problemHealth = new Set<HealthSeverity>(["unhealthy", "degraded"]);

  for (const node of system.nodes) {
    if (options.nodeId && node.id !== options.nodeId) {
      continue;
    }

    if (problemHealth.has(node.health)) {
      problems.push({
        kind: "node",
        id: node.id,
        label: node.label,
        health: node.health,
        acknowledged: options.isAcknowledged("node", node.id),
      });
    }

    for (const device of node.devices) {
      if (options.deviceId && device.id !== options.deviceId) {
        continue;
      }
      if (options.nodeId && node.id !== options.nodeId) {
        continue;
      }

      if (problemHealth.has(device.health)) {
        problems.push({
          kind: "device",
          id: device.id,
          label: device.label,
          health: device.health,
          acknowledged: options.isAcknowledged("device", device.id),
          nodeId: node.id,
        });
      }

      for (const leaf of [...device.senders, ...device.receivers]) {
        const isProblem =
          problemHealth.has(leaf.health) ||
          (options.includeUnknownWithoutMonitor &&
            leaf.health === "unknown" &&
            !leaf.hasMonitor);
        if (!isProblem) {
          continue;
        }
        problems.push({
          kind: leaf.kind,
          id: leaf.id,
          label: leaf.label,
          health: leaf.health,
          message: leaf.message,
          acknowledged: options.isAcknowledged(leaf.kind, leaf.id),
          nodeId: node.id,
          deviceId: device.id,
          hasMonitor: leaf.hasMonitor,
        });
      }
    }
  }

  return problems;
}
