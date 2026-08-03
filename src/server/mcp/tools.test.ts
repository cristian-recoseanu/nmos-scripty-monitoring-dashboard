import { describe, expect, it } from "vitest";

import { ResourceStore } from "@/server/is04";
import type { MonitorState } from "@/server/monitoring";
import type { Is05CacheEntry } from "@/server/is05/types";
import { getRootLogger } from "@/server/logging";
import {
  buildSelectionDetail,
  buildSystemSnapshot,
} from "@/server/domain/snapshot";
import type { McpContext } from "@/server/mcp/context";
import { budgetIs05, clampLimit, collectProblems } from "@/server/mcp/mappers";
import {
  getConnection,
  getDevice,
  getNode,
  getReceiver,
  getSender,
  getSystemOverview,
  listDevices,
  listNodes,
  listProblems,
  listReceivers,
  listSenders,
  summariseEntity,
} from "@/server/mcp/tools";
import { aggregateSystemHealth } from "@/server/domain/health-aggregator";

function baseMonitor(overrides: Partial<MonitorState> = {}): MonitorState {
  return {
    deviceId: "device-1",
    kind: "receiver",
    oid: 10,
    role: "ReceiverMonitor_01",
    classId: [1, 2, 2, 1],
    resourceId: "receiver-1",
    overallStatus: 3,
    overallStatusMessage: "stream down",
    health: "unhealthy",
    lastUpdated: 1_700_000_000_000,
    link: { status: 1, message: "up", transitionCounter: 0 },
    connectivity: { status: 3, message: "down", transitionCounter: 5 },
    ...overrides,
  };
}

function seedStore(options?: { mismatchPeers?: boolean }): {
  store: ResourceStore;
  monitors: Map<string, MonitorState>;
  is05: Map<string, Is05CacheEntry>;
} {
  const store = new ResourceStore();
  store.upsert("node", {
    id: "node-1",
    version: "1:0",
    label: "Node A",
    description: "",
    href: "http://node",
  });
  store.upsert("device", {
    id: "device-1",
    version: "1:0",
    label: "Device A",
    description: "",
    type: "urn:x-nmos:device:generic",
    node_id: "node-1",
    controls: [
      { type: "urn:x-nmos:control:ncp/v1.0", href: "ws://device/ncp" },
      {
        type: "urn:x-nmos:control:sr-ctrl/v1.1",
        href: "http://device/x-nmos/connection/v1.1/",
      },
    ],
  });
  store.upsert("source", {
    id: "source-1",
    version: "1:0",
    label: "Source",
    description: "",
    device_id: "device-1",
  });
  store.upsert("flow", {
    id: "flow-1",
    version: "1:0",
    label: "Flow",
    description: "",
    source_id: "source-1",
    device_id: "device-1",
    format: "urn:x-nmos:format:video",
  });
  store.upsert("sender", {
    id: "sender-1",
    version: "1:0",
    label: "Sender M",
    description: "",
    device_id: "device-1",
    flow_id: "flow-1",
    transport: "urn:x-nmos:transport:rtp",
  });
  store.upsert("receiver", {
    id: "receiver-1",
    version: "1:0",
    label: "Receiver G",
    description: "",
    device_id: "device-1",
    transport: "urn:x-nmos:transport:rtp",
    format: "urn:x-nmos:format:video",
    subscription: { sender_id: "sender-1", active: true },
  });

  const monitors = new Map<string, MonitorState>([
    ["receiver-1", baseMonitor()],
    [
      "sender-1",
      baseMonitor({
        kind: "sender",
        oid: 11,
        resourceId: "sender-1",
        health: "healthy",
        overallStatus: 1,
        overallStatusMessage: "ok",
        connectivity: { status: 1, message: "ok", transitionCounter: 0 },
      }),
    ],
  ]);

  const hugeSdp = "v=0\n" + "a=line\n".repeat(200);
  const is05SenderPeer = options?.mismatchPeers ? "other-receiver" : "receiver-1";
  const is05ReceiverPeer = options?.mismatchPeers ? "other-sender" : "sender-1";
  const is05 = new Map<string, Is05CacheEntry>([
    [
      "receiver-1",
      {
        resourceType: "receiver",
        resourceId: "receiver-1",
        deviceId: "device-1",
        status: "available",
        fetchedAt: 1_700_000_000_100,
        active: {
          sender_id: is05ReceiverPeer,
          master_enable: true,
          activation: { mode: "activate_immediate" },
          transport_file: { data: hugeSdp, type: "application/sdp" },
          transport_params: [{ destination_port: 5004 }],
        },
        transportFile: { contentType: "application/sdp", data: hugeSdp },
      },
    ],
    [
      "sender-1",
      {
        resourceType: "sender",
        resourceId: "sender-1",
        deviceId: "device-1",
        status: "error",
        error: "connection api timeout",
        fetchedAt: 1_700_000_000_200,
        active: {
          receiver_id: is05SenderPeer,
          master_enable: true,
          activation: { mode: "activate_immediate" },
          transport_params: [],
        },
        transportFile: { contentType: "application/sdp", data: hugeSdp },
      },
    ],
  ]);

  return { store, monitors, is05 };
}

function createContext(
  overrides: {
    acknowledged?: Set<string>;
    mismatchPeers?: boolean;
  } = {},
): McpContext {
  const { store, monitors, is05 } = seedStore({
    mismatchPeers: overrides.mismatchPeers,
  });
  const acknowledged = overrides.acknowledged ?? new Set<string>();
  const builderOptions = {
    store,
    getMonitor: (id: string) => monitors.get(id),
    getDeviceNcpStatus: () => ({
      deviceId: "device-1",
      availability: "available" as const,
      connected: true,
      href: "ws://device/ncp",
    }),
    getIs05: (id: string) => is05.get(id),
    isAcknowledged: (kind: string, id: string) =>
      acknowledged.has(`${kind}:${id}`),
    registryConnected: true,
    queryApiBaseUrl: "http://registry/x-nmos/query/v1.3",
  };

  return {
    getSnapshot: () => buildSystemSnapshot(builderOptions),
    getDetail: (kind, id) => buildSelectionDetail(kind, id, builderOptions),
    getStatus: () => ({
      started: true,
      registry: {
        connected: true,
        queryApiBaseUrl: "http://registry/x-nmos/query/v1.3",
        connectedPaths: ["/nodes"],
        retrying: false,
      },
    }),
    getStore: () => store,
    getMonitor: (id) => monitors.get(id),
    getDeviceNcpStatus: builderOptions.getDeviceNcpStatus,
    getIs05: (id) => is05.get(id),
    isAcknowledged: (kind, id) => acknowledged.has(`${kind}:${id}`),
    logger: getRootLogger(),
  };
}

function parsePayload(result: {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}) {
  const text = result.content[0];
  expect(text?.type).toBe("text");
  if (result.isError) {
    return { error: text!.text! };
  }
  return JSON.parse(text!.text!) as Record<string, unknown>;
}

describe("MCP investigation tools", () => {
  it("get_system_overview reports unhealthy leaves and registry status", () => {
    const ctx = createContext({
      acknowledged: new Set(["receiver:receiver-1", "device:device-1"]),
    });
    const payload = parsePayload(getSystemOverview(ctx));
    expect(payload.nodeCount).toBe(1);
    expect(
      (payload.leafHealthCounts as Record<string, number>).unhealthy +
        (payload.leafHealthCounts as Record<string, number>).acknowledged,
    ).toBeGreaterThanOrEqual(1);
    expect(payload.acknowledgedResources).toBeGreaterThanOrEqual(2);
    expect(
      (payload.registry as { connected: boolean }).connected,
    ).toBe(true);
  });

  it("lists topology entities and returns details", () => {
    const ctx = createContext();
    expect(parsePayload(listNodes(ctx)).count).toBe(1);
    expect(parsePayload(getNode(ctx, { id: "node-1" })).kind).toBe("node");
    expect(parsePayload(listDevices(ctx, { node_id: "node-1" })).count).toBe(1);
    expect(parsePayload(getDevice(ctx, { id: "device-1" })).kind).toBe("device");
    expect(parsePayload(listSenders(ctx)).count).toBe(1);
    expect(
      parsePayload(listReceivers(ctx, { health: "unhealthy", has_monitor: true }))
        .count,
    ).toBe(1);
  });

  it("returns not-found errors for missing ids", () => {
    const ctx = createContext();
    expect(getNode(ctx, { id: "missing" }).isError).toBe(true);
    expect(getDevice(ctx, { id: "missing" }).isError).toBe(true);
    expect(getSender(ctx, { id: "missing" }).isError).toBe(true);
    expect(getReceiver(ctx, { id: "missing" }).isError).toBe(true);
    expect(summariseEntity(ctx, { kind: "node" }).isError).toBe(true);
  });

  it("list_problems returns the unhealthy receiver", () => {
    const ctx = createContext();
    const payload = parsePayload(listProblems(ctx));
    const problems = payload.problems as Array<{ id: string; kind: string }>;
    expect(
      problems.some((p) => p.id === "receiver-1" && p.kind === "receiver"),
    ).toBe(true);
  });

  it("get_receiver deep-dive omits SDP by default and includes parents", () => {
    const ctx = createContext();
    const payload = parsePayload(getReceiver(ctx, { id: "receiver-1" }));
    expect(payload.id).toBe("receiver-1");
    expect(payload.bcp008).toMatchObject({ health: "unhealthy" });
    const is05 = payload.is05 as {
      transportFile?: { included: boolean; data?: string; byteLength: number };
    };
    expect(is05.transportFile?.included).toBe(false);
    expect(is05.transportFile?.data).toBeUndefined();
    expect(is05.transportFile?.byteLength).toBeGreaterThan(100);
    expect(payload.parents).toMatchObject({
      device: { id: "device-1" },
      node: { id: "node-1" },
    });
  });

  it("get_receiver can include transport file when requested", () => {
    const ctx = createContext();
    const payload = parsePayload(
      getReceiver(ctx, { id: "receiver-1", include_transport_file: true }),
    );
    const is05 = payload.is05 as {
      transportFile?: { included: boolean; data?: string };
    };
    expect(is05.transportFile?.included).toBe(true);
    expect(is05.transportFile?.data?.startsWith("v=0")).toBe(true);
  });

  it("get_sender includes flow/source", () => {
    const ctx = createContext();
    const payload = parsePayload(getSender(ctx, { id: "sender-1" }));
    expect(payload.flow).toMatchObject({ id: "flow-1" });
    expect(payload.source).toMatchObject({ id: "source-1" });
  });

  it("get_connection reports matching peers and resolves from sender_id", () => {
    const ctx = createContext();
    const fromReceiver = parsePayload(
      getConnection(ctx, { receiver_id: "receiver-1" }),
    );
    expect(fromReceiver.mismatches).toEqual([]);
    const fromSender = parsePayload(
      getConnection(ctx, { sender_id: "sender-1" }),
    );
    expect(fromSender.peers).toMatchObject({
      is04SubscriptionSenderId: "sender-1",
    });
    expect(getConnection(ctx, {}).isError).toBe(true);
  });

  it("get_connection reports peer mismatches", () => {
    const ctx = createContext({ mismatchPeers: true });
    const payload = parsePayload(
      getConnection(ctx, { receiver_id: "receiver-1", sender_id: "sender-1" }),
    );
    expect((payload.mismatches as string[]).length).toBeGreaterThan(0);
  });

  it("summarise_entity covers system/device/sender paths", () => {
    const ctx = createContext();
    expect(parsePayload(summariseEntity(ctx, { kind: "system" })).kind).toBe(
      "system",
    );
    expect(
      parsePayload(summariseEntity(ctx, { kind: "device", id: "device-1" }))
        .is05Errors,
    ).toEqual(expect.arrayContaining([expect.stringContaining("timeout")]));
    expect(
      parsePayload(summariseEntity(ctx, { kind: "sender", id: "sender-1" }))
        .kind,
    ).toBe("sender");
    expect(
      parsePayload(summariseEntity(ctx, { kind: "node", id: "node-1" })).kind,
    ).toBe("node");
  });

  it("budget helpers and clampLimit behave", () => {
    expect(clampLimit(undefined)).toBe(100);
    expect(clampLimit(9999)).toBe(500);
    expect(clampLimit(0)).toBe(1);
    const huge = "x".repeat(10_000);
    const budgeted = budgetIs05(
      {
        status: "available",
        transportFile: { contentType: "application/sdp", data: huge },
        active: {
          sender_id: "s",
          master_enable: true,
          activation: {},
          transport_file: { data: huge, type: "application/sdp" },
          transport_params: [],
        },
      },
      false,
    );
    expect(budgeted?.transportFile?.included).toBe(false);
    expect(JSON.stringify(budgeted).length).toBeLessThan(huge.length);

    const ctx = createContext();
    const system = aggregateSystemHealth({
      store: ctx.getStore(),
      getMonitor: ctx.getMonitor,
      getDeviceNcpStatus: ctx.getDeviceNcpStatus,
      isAcknowledged: ctx.isAcknowledged,
    });
    const scoped = collectProblems(system, {
      nodeId: "node-1",
      deviceId: "device-1",
      includeUnknownWithoutMonitor: true,
      isAcknowledged: () => false,
    });
    expect(scoped.length).toBeGreaterThan(0);
  });
});
