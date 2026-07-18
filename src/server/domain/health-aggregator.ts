import {
  aggregateParentHealth,
  compareSeverity,
  type HealthSeverity,
} from "@/lib/health";
import {
  classifyNmosFormat,
  type NmosFormatKind,
} from "@/lib/nmos-format";
import type {
  NmosDevice,
  NmosNode,
  NmosReceiver,
  NmosSender,
  ResourceStore,
  Uuid,
} from "@/server/is04";
import type { DeviceNcpStatus, MonitorState } from "@/server/monitoring";

export type EntityKind = "system" | "node" | "device" | "sender" | "receiver";

export type HealthContributor = {
  kind: Exclude<EntityKind, "system">;
  id: Uuid;
  label: string;
  health: HealthSeverity;
  message?: string | null;
};

export type LeafHealth = {
  id: Uuid;
  label: string;
  kind: "sender" | "receiver";
  health: HealthSeverity;
  message?: string | null;
  hasMonitor: boolean;
  totalTransitions: number;
  format: NmosFormatKind;
};

export type DeviceHealth = {
  id: Uuid;
  label: string;
  health: HealthSeverity;
  ncpAvailability: DeviceNcpStatus["availability"] | "unknown";
  ncpConnected: boolean;
  totalTransitions: number;
  senders: LeafHealth[];
  receivers: LeafHealth[];
  worstContributors: HealthContributor[];
};

export type NodeHealth = {
  id: Uuid;
  label: string;
  health: HealthSeverity;
  totalTransitions: number;
  devices: DeviceHealth[];
  worstContributors: HealthContributor[];
};

export type SystemHealth = {
  health: HealthSeverity;
  totalTransitions: number;
  nodes: NodeHealth[];
  worstContributors: HealthContributor[];
};

function labelOf(resource: { label?: string; id: string }): string {
  return resource.label?.trim() || resource.id;
}

export function sumDomainTransitions(
  monitor: MonitorState | undefined,
): number {
  if (!monitor) {
    return 0;
  }
  return (
    (monitor.link?.transitionCounter ?? 0) +
    (monitor.connectivity?.transitionCounter ?? 0) +
    (monitor.externalSync?.transitionCounter ?? 0) +
    (monitor.streamOrEssence?.transitionCounter ?? 0)
  );
}

function resolveLeafFormat(
  kind: "sender" | "receiver",
  resource: NmosSender | NmosReceiver,
  store: ResourceStore,
): NmosFormatKind {
  if (kind === "receiver") {
    return classifyNmosFormat((resource as NmosReceiver).format);
  }

  const resolved = store.resolveSenderFlowAndSource(resource.id);
  return classifyNmosFormat(
    resolved?.flow?.format ?? resolved?.source?.format,
  );
}

function leafFromResource(
  kind: "sender" | "receiver",
  resource: NmosSender | NmosReceiver,
  monitor: MonitorState | undefined,
  store: ResourceStore,
): LeafHealth {
  const format = resolveLeafFormat(kind, resource, store);
  if (monitor) {
    return {
      id: resource.id,
      label: labelOf(resource),
      kind,
      health: monitor.health,
      message: monitor.overallStatusMessage,
      hasMonitor: true,
      totalTransitions: sumDomainTransitions(monitor),
      format,
    };
  }

  return {
    id: resource.id,
    label: labelOf(resource),
    kind,
    health: "unknown",
    message: null,
    hasMonitor: false,
    totalTransitions: 0,
    format,
  };
}

function sortContributors(contributors: HealthContributor[]): HealthContributor[] {
  return [...contributors].sort((a, b) => {
    const byHealth = compareSeverity(a.health, b.health);
    if (byHealth !== 0) {
      return byHealth;
    }
    return a.label.localeCompare(b.label);
  });
}

function worstFromChildren(
  children: Array<{
    id: Uuid;
    label: string;
    health: HealthSeverity;
    message?: string | null;
    kind: HealthContributor["kind"];
  }>,
  limit = 10,
): { health: HealthSeverity; worstContributors: HealthContributor[] } {
  const health = aggregateParentHealth(children.map((child) => child.health));
  const worstContributors = sortContributors(
    children.map((child) => ({
      kind: child.kind,
      id: child.id,
      label: child.label,
      health: child.health,
      message: child.message,
    })),
  ).slice(0, limit);

  return { health, worstContributors };
}

export type HealthAggregatorInput = {
  store: ResourceStore;
  getMonitor: (resourceId: Uuid) => MonitorState | undefined;
  getDeviceNcpStatus: (deviceId: Uuid) => DeviceNcpStatus | undefined;
};

/**
 * Build bubbled health for System → Node → Device → Sender/Receiver.
 */
export function aggregateSystemHealth(
  input: HealthAggregatorInput,
): SystemHealth {
  const nodes = input.store.listNodes().map((node) =>
    aggregateNodeHealth(node, input),
  );

  // Include devices whose node is missing from the registry (orphan topology).
  const knownNodeIds = new Set(nodes.map((node) => node.id));
  const orphanDevices = input.store
    .listDevices()
    .filter((device) => !knownNodeIds.has(device.node_id));

  if (orphanDevices.length > 0) {
    const orphanNode: NmosNode = {
      id: "__orphans__",
      version: "0:0",
      label: "Unassigned devices",
      description: "Devices whose node_id is not present in the registry",
      href: "",
    };
    nodes.push(
      aggregateNodeHealth(orphanNode, input, orphanDevices),
    );
  }

  const { health, worstContributors } = worstFromChildren(
    nodes.map((node) => ({
      id: node.id,
      label: node.label,
      health: node.health,
      kind: "node" as const,
    })),
  );

  const totalTransitions = nodes.reduce(
    (sum, node) => sum + node.totalTransitions,
    0,
  );

  return {
    health: nodes.length === 0 ? "unknown" : health,
    totalTransitions,
    nodes: nodes.sort((a, b) => a.label.localeCompare(b.label)),
    worstContributors,
  };
}

export function aggregateNodeHealth(
  node: NmosNode,
  input: HealthAggregatorInput,
  devicesOverride?: NmosDevice[],
): NodeHealth {
  const devices = (devicesOverride ?? input.store.getDevicesForNode(node.id)).map(
    (device) => aggregateDeviceHealth(device, input),
  );

  const { health, worstContributors } = worstFromChildren(
    devices.map((device) => ({
      id: device.id,
      label: device.label,
      health: device.health,
      kind: "device" as const,
    })),
  );

  const totalTransitions = devices.reduce(
    (sum, device) => sum + device.totalTransitions,
    0,
  );

  return {
    id: node.id,
    label: labelOf(node),
    health: devices.length === 0 ? "unknown" : health,
    totalTransitions,
    devices: devices.sort((a, b) => a.label.localeCompare(b.label)),
    worstContributors,
  };
}

export function aggregateDeviceHealth(
  device: NmosDevice,
  input: HealthAggregatorInput,
): DeviceHealth {
  const ncp = input.getDeviceNcpStatus(device.id);
  const senders = input.store
    .getSendersForDevice(device.id)
    .map((sender) =>
      leafFromResource(
        "sender",
        sender,
        input.getMonitor(sender.id),
        input.store,
      ),
    )
    .sort((a, b) => a.label.localeCompare(b.label));

  const receivers = input.store
    .getReceiversForDevice(device.id)
    .map((receiver) =>
      leafFromResource(
        "receiver",
        receiver,
        input.getMonitor(receiver.id),
        input.store,
      ),
    )
    .sort((a, b) => a.label.localeCompare(b.label));

  const leaves = [...senders, ...receivers];
  const { health, worstContributors } = worstFromChildren(
    leaves.map((leaf) => ({
      id: leaf.id,
      label: leaf.label,
      health: leaf.health,
      message: leaf.message,
      kind: leaf.kind,
    })),
  );

  const totalTransitions = leaves.reduce(
    (sum, leaf) => sum + leaf.totalTransitions,
    0,
  );

  return {
    id: device.id,
    label: labelOf(device),
    health: leaves.length === 0 ? "unknown" : health,
    ncpAvailability: ncp?.availability ?? "unknown",
    ncpConnected: ncp?.connected ?? false,
    totalTransitions,
    senders,
    receivers,
    worstContributors,
  };
}
