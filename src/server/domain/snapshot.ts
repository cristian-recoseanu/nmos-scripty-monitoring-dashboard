import type { HealthSeverity } from "@/lib/health";
import type { NmosFormatKind } from "@/lib/nmos-format";
import type {
  NmosDevice,
  NmosFlow,
  NmosNode,
  NmosReceiver,
  NmosSender,
  NmosSource,
  Uuid,
} from "@/server/is04";
import type {
  DeviceNcpStatus,
  DomainStatusSnapshot,
  MonitorState,
} from "@/server/monitoring";
import { discoverNcpEndpoint } from "@/server/monitoring";

import {
  aggregateSystemHealth,
  sumDomainTransitions,
  type DeviceHealth,
  type EntityKind,
  type HealthAggregatorInput,
  type HealthContributor,
  type LeafHealth,
  type NodeHealth,
  type SystemHealth,
} from "./health-aggregator";

export type { EntityKind, HealthContributor };

export type TreeEntityDto = {
  kind: EntityKind;
  id: string;
  label: string;
  health: HealthSeverity;
  childCount: number;
  totalTransitions: number;
  children?: TreeEntityDto[];
  meta?: {
    hasMonitor?: boolean;
    ncpAvailability?: DeviceNcpStatus["availability"] | "unknown";
    ncpConnected?: boolean;
    /** NMOS format kind for senders/receivers (from flow/source/receiver). */
    format?: NmosFormatKind;
  };
};

export type ConnectionHubDto = {
  sender: TreeEntityDto;
  receivers: TreeEntityDto[];
};

export type ConnectionsSnapshotDto = {
  hubs: ConnectionHubDto[];
  disconnected: TreeEntityDto[];
};

export type SystemSnapshotDto = {
  generatedAt: number;
  registry: {
    connected: boolean;
    queryApiBaseUrl?: string;
    lastError?: string;
  };
  system: {
    kind: "system";
    id: "system";
    label: string;
    health: HealthSeverity;
    childCount: number;
    totalTransitions: number;
    children: TreeEntityDto[];
  };
  /** Present on current payloads; older clients may see it missing briefly. */
  connections?: ConnectionsSnapshotDto;
};

export type MonitorDomainDto = {
  name: string;
  status?: number | string;
  message?: string | null;
  transitionCounter?: number;
};

export type MonitorDetailDto = {
  oid: number;
  kind: "sender" | "receiver";
  role: string;
  overallStatus?: number | string;
  overallStatusMessage?: string | null;
  statusReportingDelay?: number;
  autoResetCountersAndMessages?: boolean;
  synchronizationSourceId?: string | null;
  health: HealthSeverity;
  totalTransitions: number;
  domains: MonitorDomainDto[];
};

export type SelectionDetailDto =
  | {
      kind: "system";
      id: "system";
      label: string;
      health: HealthSeverity;
      totalTransitions: number;
      worstContributors: HealthContributor[];
    }
  | {
      kind: "node";
      id: string;
      label: string;
      health: HealthSeverity;
      totalTransitions: number;
      resource: NmosNode;
      worstContributors: HealthContributor[];
    }
  | {
      kind: "device";
      id: string;
      label: string;
      health: HealthSeverity;
      totalTransitions: number;
      resource: NmosDevice;
      ncp: {
        availability: DeviceNcpStatus["availability"] | "unknown";
        connected: boolean;
        href?: string;
        lastError?: string;
        controlType?: string;
      };
      worstContributors: HealthContributor[];
    }
  | {
      kind: "sender";
      id: string;
      label: string;
      health: HealthSeverity;
      resource: NmosSender;
      flow?: NmosFlow;
      source?: NmosSource;
      monitor?: MonitorDetailDto;
      deviceId: string;
    }
  | {
      kind: "receiver";
      id: string;
      label: string;
      health: HealthSeverity;
      resource: NmosReceiver;
      connectedSender?: {
        id: string;
        label: string;
        deviceId: string;
        health: HealthSeverity;
      };
      monitor?: MonitorDetailDto;
      deviceId: string;
    };

function domain(
  name: string,
  snapshot: DomainStatusSnapshot | undefined,
): MonitorDomainDto {
  return {
    name,
    status: snapshot?.status,
    message: snapshot?.message,
    transitionCounter: snapshot?.transitionCounter,
  };
}

export function monitorToDto(state: MonitorState): MonitorDetailDto {
  const domains: MonitorDomainDto[] =
    state.kind === "receiver"
      ? [
          domain("linkStatus", state.link),
          domain("connectionStatus", state.connectivity),
          domain("externalSynchronizationStatus", state.externalSync),
          domain("streamStatus", state.streamOrEssence),
        ]
      : [
          domain("linkStatus", state.link),
          domain("transmissionStatus", state.connectivity),
          domain("externalSynchronizationStatus", state.externalSync),
          domain("essenceStatus", state.streamOrEssence),
        ];

  return {
    oid: state.oid,
    kind: state.kind,
    role: state.role,
    overallStatus: state.overallStatus,
    overallStatusMessage: state.overallStatusMessage,
    statusReportingDelay: state.statusReportingDelay,
    autoResetCountersAndMessages: state.autoResetCountersAndMessages,
    synchronizationSourceId: state.synchronizationSourceId,
    health: state.health,
    totalTransitions: sumDomainTransitions(state),
    domains,
  };
}

function leafToTree(leaf: LeafHealth): TreeEntityDto {
  return {
    kind: leaf.kind,
    id: leaf.id,
    label: leaf.label,
    health: leaf.health,
    childCount: 0,
    totalTransitions: leaf.totalTransitions,
    meta: { hasMonitor: leaf.hasMonitor, format: leaf.format },
  };
}

function deviceToTree(device: DeviceHealth): TreeEntityDto {
  const children: TreeEntityDto[] = [
    ...device.senders.map(leafToTree),
    ...device.receivers.map(leafToTree),
  ];

  return {
    kind: "device",
    id: device.id,
    label: device.label,
    health: device.health,
    childCount: children.length,
    totalTransitions: device.totalTransitions,
    children,
    meta: {
      ncpAvailability: device.ncpAvailability,
      ncpConnected: device.ncpConnected,
    },
  };
}

function nodeToTree(node: NodeHealth): TreeEntityDto {
  const children = node.devices.map(deviceToTree);
  return {
    kind: "node",
    id: node.id,
    label: node.label,
    health: node.health,
    childCount: children.length,
    totalTransitions: node.totalTransitions,
    children,
  };
}

export type SnapshotBuilderOptions = HealthAggregatorInput & {
  registryConnected: boolean;
  queryApiBaseUrl?: string;
  registryLastError?: string;
  systemLabel?: string;
};

/**
 * Group receivers under their active connected sender; unconnected receivers
 * go into `disconnected`.
 */
export function buildConnectionsSnapshot(
  options: SnapshotBuilderOptions,
  systemHealth?: SystemHealth,
): ConnectionsSnapshotDto {
  const system = systemHealth ?? aggregateSystemHealth(options);
  const hubs = new Map<string, ConnectionHubDto>();

  for (const node of system.nodes) {
    for (const device of node.devices) {
      for (const sender of device.senders) {
        hubs.set(sender.id, {
          sender: leafToTree(sender),
          receivers: [],
        });
      }
    }
  }

  const disconnected: TreeEntityDto[] = [];

  for (const node of system.nodes) {
    for (const device of node.devices) {
      for (const receiver of device.receivers) {
        const leaf = leafToTree(receiver);
        const connected = options.store.getConnectedSender(receiver.id);
        if (connected && hubs.has(connected.id)) {
          hubs.get(connected.id)!.receivers.push(leaf);
        } else {
          disconnected.push(leaf);
        }
      }
    }
  }

  for (const hub of hubs.values()) {
    hub.receivers.sort((a, b) => a.label.localeCompare(b.label));
  }

  return {
    hubs: [...hubs.values()].sort((a, b) =>
      a.sender.label.localeCompare(b.sender.label),
    ),
    disconnected: disconnected.sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export function buildSystemSnapshot(
  options: SnapshotBuilderOptions,
): SystemSnapshotDto {
  const system = aggregateSystemHealth(options);
  const children = system.nodes.map(nodeToTree);

  return {
    generatedAt: Date.now(),
    registry: {
      connected: options.registryConnected,
      queryApiBaseUrl: options.queryApiBaseUrl,
      lastError: options.registryLastError,
    },
    system: {
      kind: "system",
      id: "system",
      label: options.systemLabel ?? "System",
      health: system.health,
      childCount: children.length,
      totalTransitions: system.totalTransitions,
      children,
    },
    connections: buildConnectionsSnapshot(options, system),
  };
}

export function buildSelectionDetail(
  kind: EntityKind,
  id: string,
  options: SnapshotBuilderOptions,
): SelectionDetailDto | undefined {
  const system = aggregateSystemHealth(options);

  if (kind === "system") {
    return {
      kind: "system",
      id: "system",
      label: options.systemLabel ?? "System",
      health: system.health,
      totalTransitions: system.totalTransitions,
      worstContributors: system.worstContributors,
    };
  }

  if (kind === "node") {
    const node = system.nodes.find((entry) => entry.id === id);
    const resource = options.store.getNode(id);
    if (!node || !resource) {
      // Orphan synthetic node
      if (node && id === "__orphans__") {
        return {
          kind: "node",
          id,
          label: node.label,
          health: node.health,
          totalTransitions: node.totalTransitions,
          resource: {
            id,
            version: "0:0",
            label: node.label,
            description: "Devices without a registered node",
            href: "",
          },
          worstContributors: node.worstContributors,
        };
      }
      return undefined;
    }
    return {
      kind: "node",
      id,
      label: node.label,
      health: node.health,
      totalTransitions: node.totalTransitions,
      resource,
      worstContributors: node.worstContributors,
    };
  }

  if (kind === "device") {
    const resource = options.store.getDevice(id);
    if (!resource) {
      return undefined;
    }
    const deviceHealth = findDeviceHealth(system, id);
    const ncp = options.getDeviceNcpStatus(id);
    const endpoint = discoverNcpEndpoint(resource);
    return {
      kind: "device",
      id,
      label: deviceHealth?.label ?? resource.label ?? id,
      health: deviceHealth?.health ?? "unknown",
      totalTransitions: deviceHealth?.totalTransitions ?? 0,
      resource,
      ncp: {
        availability: ncp?.availability ?? endpoint.availability,
        connected: ncp?.connected ?? false,
        href: ncp?.href ?? endpoint.href,
        lastError: ncp?.lastError,
        controlType: endpoint.controlType,
      },
      worstContributors: deviceHealth?.worstContributors ?? [],
    };
  }

  if (kind === "sender") {
    const resolved = options.store.resolveSenderFlowAndSource(id);
    if (!resolved) {
      return undefined;
    }
    const monitor = options.getMonitor(id);
    return {
      kind: "sender",
      id,
      label: resolved.sender.label || id,
      health: monitor?.health ?? "unknown",
      resource: resolved.sender,
      flow: resolved.flow,
      source: resolved.source,
      monitor: monitor ? monitorToDto(monitor) : undefined,
      deviceId: resolved.sender.device_id,
    };
  }

  if (kind === "receiver") {
    const resource = options.store.getReceiver(id);
    if (!resource) {
      return undefined;
    }
    const monitor = options.getMonitor(id);
    const connected = options.store.getConnectedSender(id);
    const connectedMonitor = connected
      ? options.getMonitor(connected.id)
      : undefined;

    return {
      kind: "receiver",
      id,
      label: resource.label || id,
      health: monitor?.health ?? "unknown",
      resource,
      connectedSender: connected
        ? {
            id: connected.id,
            label: connected.label || connected.id,
            deviceId: connected.device_id,
            health: connectedMonitor?.health ?? "unknown",
          }
        : undefined,
      monitor: monitor ? monitorToDto(monitor) : undefined,
      deviceId: resource.device_id,
    };
  }

  return undefined;
}

function findDeviceHealth(
  system: SystemHealth,
  deviceId: Uuid,
): DeviceHealth | undefined {
  for (const node of system.nodes) {
    const device = node.devices.find((entry) => entry.id === deviceId);
    if (device) {
      return device;
    }
  }
  return undefined;
}

export type SnapshotBuilder = {
  buildSnapshot: () => SystemSnapshotDto;
  buildDetail: (kind: EntityKind, id: string) => SelectionDetailDto | undefined;
};
