import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { HealthSeverity } from "@/lib/health";
import {
  aggregateSystemHealth,
  type SystemHealth,
} from "@/server/domain/health-aggregator";
import { toIs05DetailDto } from "@/server/is05/types";
import type { McpContext } from "@/server/mcp/context";
import {
  budgetIs05,
  budgetMonitor,
  clampLimit,
  collectProblems,
  walkLeaves,
  type CompactLeafRow,
} from "@/server/mcp/mappers";

const healthFilterSchema = z.enum([
  "unhealthy",
  "degraded",
  "unknown",
  "healthy",
  "inactive",
  "acknowledged",
]);

export const listFilterSchema = z.object({
  device_id: z.string().min(1).optional(),
  health: healthFilterSchema.optional(),
  acked: z.boolean().optional(),
  has_monitor: z.boolean().optional(),
  format: z.string().min(1).optional(),
  limit: z.number().int().positive().optional(),
});

export const scopeSchema = z.object({
  node_id: z.string().min(1).optional(),
  device_id: z.string().min(1).optional(),
  include_unknown_without_monitor: z.boolean().optional(),
  limit: z.number().int().positive().optional(),
});

export const idSchema = z.object({
  id: z.string().min(1),
});

export const listDevicesSchema = z.object({
  node_id: z.string().min(1).optional(),
  limit: z.number().int().positive().optional(),
});

export const leafDeepDiveSchema = z.object({
  id: z.string().min(1),
  include_transport_file: z.boolean().optional(),
});

export const connectionInputSchema = z.object({
  receiver_id: z.string().min(1).optional(),
  sender_id: z.string().min(1).optional(),
});

export const connectionSchema = connectionInputSchema.refine(
  (value) => Boolean(value.receiver_id || value.sender_id),
  {
    message: "Provide receiver_id and/or sender_id",
  },
);

export const summariseSchema = z.object({
  kind: z.enum(["system", "node", "device", "sender", "receiver"]),
  id: z.string().min(1).optional(),
});

function textResult(payload: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

function healthInput(ctx: McpContext) {
  return {
    store: ctx.getStore(),
    getMonitor: ctx.getMonitor,
    getDeviceNcpStatus: ctx.getDeviceNcpStatus,
    isAcknowledged: ctx.isAcknowledged,
  };
}

function systemHealth(ctx: McpContext): SystemHealth {
  return aggregateSystemHealth(healthInput(ctx));
}

function findParents(system: SystemHealth, deviceId: string) {
  for (const node of system.nodes) {
    const device = node.devices.find((d) => d.id === deviceId);
    if (device) {
      return { node, device };
    }
  }
  return undefined;
}

function toCompactLeaf(
  ctx: McpContext,
  system: SystemHealth,
  kind: "sender" | "receiver",
): CompactLeafRow[] {
  const store = ctx.getStore();
  const rows: CompactLeafRow[] = [];
  for (const { leaf, device, node } of walkLeaves(system)) {
    if (leaf.kind !== kind) {
      continue;
    }
    let connectedPeerId: string | null | undefined;
    if (kind === "receiver") {
      connectedPeerId =
        store.getConnectedSender(leaf.id)?.id ??
        (() => {
          const is05 = ctx.getIs05(leaf.id)?.active;
          return is05 && "sender_id" in is05 ? is05.sender_id : null;
        })();
    } else {
      const is05 = ctx.getIs05(leaf.id)?.active;
      connectedPeerId =
        is05 && "receiver_id" in is05 ? is05.receiver_id : null;
    }
    rows.push({
      kind: leaf.kind,
      id: leaf.id,
      label: leaf.label,
      health: leaf.health,
      totalTransitions: leaf.totalTransitions,
      deviceId: device.id,
      nodeId: node.id,
      format: leaf.format,
      hasMonitor: leaf.hasMonitor,
      acknowledged: ctx.isAcknowledged(leaf.kind, leaf.id),
      connectedPeerId,
      message: leaf.message,
    });
  }
  return rows;
}

function filterLeaves(
  rows: CompactLeafRow[],
  filters: z.infer<typeof listFilterSchema>,
): CompactLeafRow[] {
  return rows.filter((row) => {
    if (filters.device_id && row.deviceId !== filters.device_id) {
      return false;
    }
    if (filters.health && row.health !== filters.health) {
      return false;
    }
    if (filters.acked !== undefined && row.acknowledged !== filters.acked) {
      return false;
    }
    if (
      filters.has_monitor !== undefined &&
      row.hasMonitor !== filters.has_monitor
    ) {
      return false;
    }
    if (filters.format && row.format !== filters.format) {
      return false;
    }
    return true;
  });
}

export function getSystemOverview(ctx: McpContext) {
  const snapshot = ctx.getSnapshot();
  const status = ctx.getStatus();
  const system = systemHealth(ctx);
  const leaves = walkLeaves(system);

  const counts: Record<HealthSeverity, number> = {
    unhealthy: 0,
    degraded: 0,
    acknowledged: 0,
    unknown: 0,
    healthy: 0,
    inactive: 0,
  };
  for (const { leaf } of leaves) {
    counts[leaf.health] += 1;
  }

  let acknowledgedResources = 0;
  for (const node of system.nodes) {
    if (ctx.isAcknowledged("node", node.id)) {
      acknowledgedResources += 1;
    }
    for (const device of node.devices) {
      if (ctx.isAcknowledged("device", device.id)) {
        acknowledgedResources += 1;
      }
      for (const leaf of [...device.senders, ...device.receivers]) {
        if (ctx.isAcknowledged(leaf.kind, leaf.id)) {
          acknowledgedResources += 1;
        }
      }
    }
  }

  return textResult({
    generatedAt: snapshot.generatedAt,
    health: system.health,
    totalTransitions: system.totalTransitions,
    nodeCount: system.nodes.length,
    leafHealthCounts: counts,
    acknowledgedResources,
    registry: {
      connected: status.registry.connected,
      queryApiBaseUrl: status.registry.queryApiBaseUrl,
      lastError: status.registry.lastError,
      retrying: "retrying" in status.registry ? status.registry.retrying : undefined,
    },
    worstContributors: system.worstContributors,
    notes: [
      "Acked resources report health 'acknowledged' for themselves; parents ignore acked children for health and transition sums.",
    ],
  });
}

export function listNodes(ctx: McpContext, args: { limit?: number } = {}) {
  const limit = clampLimit(args.limit);
  const system = systemHealth(ctx);
  const nodes = system.nodes.slice(0, limit).map((node) => ({
    id: node.id,
    label: node.label,
    health: node.health,
    totalTransitions: node.totalTransitions,
    deviceCount: node.devices.length,
    acknowledged: ctx.isAcknowledged("node", node.id),
    worstContributors: node.worstContributors.slice(0, 5),
  }));
  return textResult({
    generatedAt: Date.now(),
    count: nodes.length,
    truncated: system.nodes.length > nodes.length,
    nodes,
  });
}

export function getNode(ctx: McpContext, args: { id: string }) {
  const detail = ctx.getDetail("node", args.id);
  if (!detail || detail.kind !== "node") {
    return errorResult(`Node not found: ${args.id}`);
  }
  return textResult({
    generatedAt: Date.now(),
    ...detail,
  });
}

export function listDevices(
  ctx: McpContext,
  args: { node_id?: string; limit?: number } = {},
) {
  const limit = clampLimit(args.limit);
  const system = systemHealth(ctx);
  const store = ctx.getStore();
  const devices = system.nodes
    .filter((node) => !args.node_id || node.id === args.node_id)
    .flatMap((node) =>
      node.devices.map((device) => ({
        id: device.id,
        label: device.label,
        nodeId: node.id,
        health: device.health,
        totalTransitions: device.totalTransitions,
        senderCount: device.senders.length,
        receiverCount: device.receivers.length,
        ncpAvailability: device.ncpAvailability,
        ncpConnected: device.ncpConnected,
        acknowledged: ctx.isAcknowledged("device", device.id),
        controlsSummary: (store.getDevice(device.id)?.controls ?? [])
          .map((c) => c.type)
          .slice(0, 8),
        worstContributors: device.worstContributors.slice(0, 5),
      })),
    )
    .slice(0, limit);

  return textResult({
    generatedAt: Date.now(),
    count: devices.length,
    devices,
  });
}

export function getDevice(ctx: McpContext, args: { id: string }) {
  const detail = ctx.getDetail("device", args.id);
  if (!detail || detail.kind !== "device") {
    return errorResult(`Device not found: ${args.id}`);
  }
  const system = systemHealth(ctx);
  const parents = findParents(system, args.id);
  return textResult({
    generatedAt: Date.now(),
    ...detail,
    sendersSummary: parents?.device.senders.map((s) => ({
      id: s.id,
      label: s.label,
      health: s.health,
      transitions: s.totalTransitions,
    })),
    receiversSummary: parents?.device.receivers.map((r) => ({
      id: r.id,
      label: r.label,
      health: r.health,
      transitions: r.totalTransitions,
    })),
  });
}

export function listSenders(
  ctx: McpContext,
  args: z.infer<typeof listFilterSchema> = {},
) {
  const system = systemHealth(ctx);
  const filtered = filterLeaves(toCompactLeaf(ctx, system, "sender"), args);
  const limit = clampLimit(args.limit);
  const rows = filtered.slice(0, limit);
  return textResult({
    generatedAt: Date.now(),
    count: rows.length,
    truncated: filtered.length > rows.length,
    senders: rows,
  });
}

export function listReceivers(
  ctx: McpContext,
  args: z.infer<typeof listFilterSchema> = {},
) {
  const system = systemHealth(ctx);
  const filtered = filterLeaves(toCompactLeaf(ctx, system, "receiver"), args);
  const limit = clampLimit(args.limit);
  const rows = filtered.slice(0, limit);
  return textResult({
    generatedAt: Date.now(),
    count: rows.length,
    truncated: filtered.length > rows.length,
    receivers: rows,
  });
}

function leafDeepDive(
  ctx: McpContext,
  kind: "sender" | "receiver",
  args: { id: string; include_transport_file?: boolean },
) {
  const detail = ctx.getDetail(kind, args.id);
  if (!detail || detail.kind !== kind) {
    return errorResult(`${kind} not found: ${args.id}`);
  }

  const system = systemHealth(ctx);
  const parents = findParents(system, detail.deviceId);
  const includeTf = Boolean(args.include_transport_file);

  return textResult({
    generatedAt: Date.now(),
    kind: detail.kind,
    id: detail.id,
    label: detail.label,
    health: detail.health,
    acknowledged: detail.acknowledged,
    is04: detail.resource,
    ...(detail.kind === "sender"
      ? { flow: detail.flow, source: detail.source }
      : { connectedSender: detail.connectedSender }),
    is05: budgetIs05(detail.is05, includeTf),
    bcp008: budgetMonitor(detail.monitor),
    parents: {
      device: parents
        ? {
            id: parents.device.id,
            label: parents.device.label,
            health: parents.device.health,
          }
        : { id: detail.deviceId },
      node: parents
        ? {
            id: parents.node.id,
            label: parents.node.label,
            health: parents.node.health,
          }
        : undefined,
    },
    freshness: {
      monitorLastUpdated: detail.monitor
        ? ctx.getMonitor(args.id)?.lastUpdated
        : undefined,
      is05FetchedAt: detail.is05?.fetchedAt,
    },
    notes: [
      "Transport file / SDP omitted by default; pass include_transport_file=true to include.",
      "Parents ignore acked children when computing bubbled health and transition sums.",
    ],
  });
}

export function getSender(
  ctx: McpContext,
  args: { id: string; include_transport_file?: boolean },
) {
  return leafDeepDive(ctx, "sender", args);
}

export function getReceiver(
  ctx: McpContext,
  args: { id: string; include_transport_file?: boolean },
) {
  return leafDeepDive(ctx, "receiver", args);
}

export function getConnection(
  ctx: McpContext,
  args: { receiver_id?: string; sender_id?: string },
) {
  const parsed = connectionSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult(parsed.error.issues.map((i) => i.message).join("; "));
  }
  args = parsed.data;  const store = ctx.getStore();
  let receiverId = args.receiver_id;
  let senderId = args.sender_id;

  if (receiverId && !senderId) {
    senderId = store.getConnectedSender(receiverId)?.id;
    const is05 = ctx.getIs05(receiverId)?.active;
    if (!senderId && is05 && "sender_id" in is05 && is05.sender_id) {
      senderId = is05.sender_id;
    }
  }
  if (senderId && !receiverId) {
    const is05 = ctx.getIs05(senderId)?.active;
    if (is05 && "receiver_id" in is05 && is05.receiver_id) {
      receiverId = is05.receiver_id;
    }
    if (!receiverId) {
      const match = store
        .listReceivers()
        .find(
          (r) =>
            r.subscription?.active && r.subscription.sender_id === senderId,
        );
      receiverId = match?.id;
    }
  }

  if (!receiverId && !senderId) {
    return errorResult("Could not resolve a receiver/sender pair from the given ids");
  }

  const receiver = receiverId ? store.getReceiver(receiverId) : undefined;
  const sender = senderId ? store.getSender(senderId) : undefined;
  const is04Peer = receiverId
    ? store.getConnectedSender(receiverId)?.id ?? null
    : null;
  const receiverIs05 = receiverId ? ctx.getIs05(receiverId) : undefined;
  const senderIs05 = senderId ? ctx.getIs05(senderId) : undefined;
  const is05PeerFromReceiver =
    receiverIs05?.active && "sender_id" in receiverIs05.active
      ? receiverIs05.active.sender_id
      : null;
  const is05PeerFromSender =
    senderIs05?.active && "receiver_id" in senderIs05.active
      ? senderIs05.active.receiver_id
      : null;

  const mismatches: string[] = [];
  if (
    is04Peer &&
    is05PeerFromReceiver &&
    is04Peer !== is05PeerFromReceiver
  ) {
    mismatches.push(
      `IS-04 subscription sender_id (${is04Peer}) differs from IS-05 receiver active.sender_id (${is05PeerFromReceiver})`,
    );
  }
  if (
    receiverId &&
    is05PeerFromSender &&
    is05PeerFromSender !== receiverId
  ) {
    mismatches.push(
      `IS-05 sender active.receiver_id (${is05PeerFromSender}) differs from investigated receiver (${receiverId})`,
    );
  }
  if (senderId && is04Peer && is04Peer !== senderId) {
    mismatches.push(
      `IS-04 connected sender (${is04Peer}) differs from investigated sender (${senderId})`,
    );
  }

  return textResult({
    generatedAt: Date.now(),
    receiver: receiver
      ? {
          id: receiver.id,
          label: receiver.label,
          deviceId: receiver.device_id,
          health: ctx.getDetail("receiver", receiver.id)?.health,
          subscription: receiver.subscription,
        }
      : receiverId
        ? { id: receiverId, missing: true }
        : null,
    sender: sender
      ? {
          id: sender.id,
          label: sender.label,
          deviceId: sender.device_id,
          health: ctx.getDetail("sender", sender.id)?.health,
        }
      : senderId
        ? { id: senderId, missing: true }
        : null,
    peers: {
      is04SubscriptionSenderId: is04Peer,
      is05ReceiverActiveSenderId: is05PeerFromReceiver,
      is05SenderActiveReceiverId: is05PeerFromSender,
    },
    mismatches,
    is05: {
      receiver: budgetIs05(
        receiverIs05 ? toIs05DetailDto(receiverIs05) : undefined,
        false,
      ),
      sender: budgetIs05(
        senderIs05 ? toIs05DetailDto(senderIs05) : undefined,
        false,
      ),
    },
  });
}

export function listProblems(
  ctx: McpContext,
  args: z.infer<typeof scopeSchema> = {},
) {
  const system = systemHealth(ctx);
  const problems = collectProblems(system, {
    nodeId: args.node_id,
    deviceId: args.device_id,
    includeUnknownWithoutMonitor: args.include_unknown_without_monitor,
    isAcknowledged: (kind, id) => ctx.isAcknowledged(kind, id),
  });
  const limit = clampLimit(args.limit);
  const rows = problems.slice(0, limit);
  return textResult({
    generatedAt: Date.now(),
    systemHealth: system.health,
    count: rows.length,
    truncated: problems.length > rows.length,
    problems: rows,
  });
}

export function summariseEntity(
  ctx: McpContext,
  args: { kind: "system" | "node" | "device" | "sender" | "receiver"; id?: string },
) {
  if (args.kind !== "system" && !args.id) {
    return errorResult(`id is required for kind=${args.kind}`);
  }

  const system = systemHealth(ctx);
  if (args.kind === "system") {
    const problems = collectProblems(system, {
      isAcknowledged: (kind, id) => ctx.isAcknowledged(kind, id),
    });
    return textResult({
      generatedAt: Date.now(),
      kind: "system",
      health: system.health,
      totalTransitions: system.totalTransitions,
      worstContributors: system.worstContributors,
      problemCount: problems.length,
      topProblems: problems.slice(0, 10),
      notes: [
        "Acked children are excluded from parent health and transition sums.",
      ],
    });
  }

  const detail = ctx.getDetail(args.kind, args.id!);
  if (!detail) {
    return errorResult(`${args.kind} not found: ${args.id}`);
  }

  const unboundMonitors: string[] = [];
  const is05Errors: string[] = [];

  if (detail.kind === "device") {
    const parents = findParents(system, detail.id);
    for (const leaf of [
      ...(parents?.device.senders ?? []),
      ...(parents?.device.receivers ?? []),
    ]) {
      if (!leaf.hasMonitor && leaf.health !== "inactive") {
        unboundMonitors.push(`${leaf.kind}:${leaf.id}`);
      }
      const is05 = ctx.getIs05(leaf.id);
      if (is05?.status === "error" && is05.error) {
        is05Errors.push(`${leaf.kind}:${leaf.id}: ${is05.error}`);
      }
    }
  }

  if (detail.kind === "sender" || detail.kind === "receiver") {
    if (!detail.monitor) {
      unboundMonitors.push(`${detail.kind}:${detail.id}`);
    }
    if (detail.is05?.status === "error" && detail.is05.error) {
      is05Errors.push(detail.is05.error);
    }
  }

  return textResult({
    generatedAt: Date.now(),
    kind: detail.kind,
    id: detail.id,
    label: detail.label,
    health: detail.health,
    acknowledged: "acknowledged" in detail ? detail.acknowledged : false,
    totalTransitions:
      "totalTransitions" in detail ? detail.totalTransitions : undefined,
    worstContributors:
      "worstContributors" in detail ? detail.worstContributors : undefined,
    unboundMonitors,
    is05Errors,
    notes: [
      "Acked resources show health 'acknowledged'; parents ignore them for bubbling.",
    ],
  });
}
