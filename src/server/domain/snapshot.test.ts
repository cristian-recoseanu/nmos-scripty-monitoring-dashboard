import { describe, expect, it, vi } from "vitest";

import { ResourceStore } from "@/server/is04";
import type { MonitorState } from "@/server/monitoring";
import {
  buildConnectionsSnapshot,
  buildSelectionDetail,
  buildSystemSnapshot,
  monitorToDto,
} from "@/server/domain/snapshot";
import { RuntimeEventBus } from "@/server/domain/event-bus";

function baseMonitor(overrides: Partial<MonitorState> = {}): MonitorState {
  return {
    deviceId: "device-1",
    kind: "receiver",
    oid: 10,
    role: "ReceiverMonitor_01",
    classId: [1, 2, 2, 1],
    resourceId: "receiver-1",
    overallStatus: 2,
    overallStatusMessage: "degraded",
    health: "degraded",
    lastUpdated: Date.now(),
    link: { status: 1, message: "up", transitionCounter: 0 },
    connectivity: { status: 2, message: "lossy", transitionCounter: 3 },
    ...overrides,
  };
}

describe("buildSystemSnapshot / buildSelectionDetail", () => {
  it("builds a hierarchical snapshot and selection details", () => {
    const store = new ResourceStore();
    store.upsert("node", {
      id: "node-1",
      version: "1:0",
      label: "Node",
      description: "desc",
      href: "http://node",
    });
    store.upsert("device", {
      id: "device-1",
      version: "1:0",
      label: "Device",
      description: "",
      type: "urn:x-nmos:device:generic",
      node_id: "node-1",
      controls: [
        {
          type: "urn:x-nmos:control:ncp/v1.0",
          href: "ws://device/ncp",
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
      label: "Sender",
      description: "",
      device_id: "device-1",
      flow_id: "flow-1",
      transport: "urn:x-nmos:transport:rtp",
    });
    store.upsert("receiver", {
      id: "receiver-1",
      version: "1:0",
      label: "Receiver",
      description: "",
      device_id: "device-1",
      transport: "urn:x-nmos:transport:rtp",
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
        }),
      ],
    ]);

    const options = {
      store,
      getMonitor: (id: string) => monitors.get(id),
      getDeviceNcpStatus: () => ({
        deviceId: "device-1",
        availability: "available" as const,
        connected: true,
        href: "ws://device/ncp",
      }),
      registryConnected: true,
      queryApiBaseUrl: "http://registry:3211/x-nmos/query/v1.3",
    };

    const snapshot = buildSystemSnapshot(options);
    expect(snapshot.system.children).toHaveLength(1);
    expect(snapshot.system.children[0]?.children?.[0]?.children).toHaveLength(2);
    expect(snapshot.registry.connected).toBe(true);
    expect(snapshot.connections.hubs).toHaveLength(1);
    expect(snapshot.connections.hubs[0]?.sender.id).toBe("sender-1");
    expect(snapshot.connections.hubs[0]?.receivers.map((r) => r.id)).toEqual([
      "receiver-1",
    ]);
    expect(snapshot.connections.disconnected).toEqual([]);

    const systemDetail = buildSelectionDetail("system", "system", options);
    expect(systemDetail?.kind).toBe("system");
    expect(systemDetail && "worstContributors" in systemDetail).toBe(true);

    const nodeDetail = buildSelectionDetail("node", "node-1", options);
    expect(nodeDetail?.kind).toBe("node");
    if (nodeDetail?.kind === "node") {
      expect(nodeDetail.resource.href).toBe("http://node");
    }

    const deviceDetail = buildSelectionDetail("device", "device-1", options);
    expect(deviceDetail?.kind).toBe("device");
    if (deviceDetail?.kind === "device") {
      expect(deviceDetail.ncp.connected).toBe(true);
      expect(deviceDetail.ncp.href).toBe("ws://device/ncp");
    }

    const senderDetail = buildSelectionDetail("sender", "sender-1", options);
    expect(senderDetail?.kind).toBe("sender");
    if (senderDetail?.kind === "sender") {
      expect(senderDetail.flow?.id).toBe("flow-1");
      expect(senderDetail.source?.id).toBe("source-1");
      expect(senderDetail.monitor?.oid).toBe(11);
    }

    const receiverDetail = buildSelectionDetail(
      "receiver",
      "receiver-1",
      options,
    );
    expect(receiverDetail?.kind).toBe("receiver");
    if (receiverDetail?.kind === "receiver") {
      expect(receiverDetail.connectedSender?.id).toBe("sender-1");
      expect(receiverDetail.monitor?.domains[0]?.name).toBe("linkStatus");
    }

    expect(buildSelectionDetail("sender", "missing", options)).toBeUndefined();
  });

  it("puts inactive and orphaned receivers into disconnected hubs", () => {
    const store = new ResourceStore();
    store.upsert("node", {
      id: "node-1",
      version: "1:0",
      label: "Node",
      description: "",
      href: "http://node",
    });
    store.upsert("device", {
      id: "device-1",
      version: "1:0",
      label: "Device",
      description: "",
      type: "urn:x-nmos:device:generic",
      node_id: "node-1",
    });
    store.upsert("sender", {
      id: "sender-a",
      version: "1:0",
      label: "Sender A",
      description: "",
      device_id: "device-1",
      flow_id: null,
      transport: "urn:x-nmos:transport:rtp",
    });
    store.upsert("sender", {
      id: "sender-b",
      version: "1:0",
      label: "Sender B",
      description: "",
      device_id: "device-1",
      flow_id: null,
      transport: "urn:x-nmos:transport:rtp",
    });
    store.upsert("receiver", {
      id: "rx-active",
      version: "1:0",
      label: "Rx Active",
      description: "",
      device_id: "device-1",
      transport: "urn:x-nmos:transport:rtp",
      format: "urn:x-nmos:format:video",
      subscription: { sender_id: "sender-b", active: true },
    });
    store.upsert("receiver", {
      id: "rx-idle",
      version: "1:0",
      label: "Rx Idle",
      description: "",
      device_id: "device-1",
      transport: "urn:x-nmos:transport:rtp",
      format: "urn:x-nmos:format:audio",
      subscription: { sender_id: "sender-a", active: false },
    });
    store.upsert("receiver", {
      id: "rx-missing-sender",
      version: "1:0",
      label: "Rx Missing",
      description: "",
      device_id: "device-1",
      transport: "urn:x-nmos:transport:rtp",
      subscription: { sender_id: "gone", active: true },
    });

    const connections = buildConnectionsSnapshot({
      store,
      getMonitor: () => undefined,
      getDeviceNcpStatus: () => undefined,
      registryConnected: true,
    });

    expect(connections.hubs.map((hub) => hub.sender.id)).toEqual([
      "sender-a",
      "sender-b",
    ]);
    expect(
      connections.hubs.find((hub) => hub.sender.id === "sender-b")?.receivers.map(
        (receiver) => receiver.id,
      ),
    ).toEqual(["rx-active"]);
    expect(
      connections.hubs.find((hub) => hub.sender.id === "sender-a")?.receivers,
    ).toEqual([]);
    expect(connections.disconnected.map((receiver) => receiver.id)).toEqual([
      "rx-idle",
      "rx-missing-sender",
    ]);
  });

  it("maps monitor domains for sender and receiver", () => {
    const rx = monitorToDto(baseMonitor());
    expect(rx.domains.map((d) => d.name)).toEqual([
      "linkStatus",
      "connectionStatus",
      "externalSynchronizationStatus",
      "streamStatus",
    ]);

    const tx = monitorToDto(
      baseMonitor({ kind: "sender", oid: 11, resourceId: "sender-1" }),
    );
    expect(tx.domains.map((d) => d.name)).toContain("transmissionStatus");
    expect(tx.domains.map((d) => d.name)).toContain("essenceStatus");
    expect(tx.totalTransitions).toBe(3);
  });
});

describe("RuntimeEventBus", () => {
  it("debounces snapshot broadcasts", async () => {
    vi.useFakeTimers();
    const build = vi.fn(() => ({
      generatedAt: 1,
      registry: { connected: false },
      system: {
        kind: "system" as const,
        id: "system" as const,
        label: "System",
        health: "unknown" as const,
        childCount: 0,
        totalTransitions: 0,
        children: [],
      },
      connections: { hubs: [], disconnected: [] },
    }));

    const bus = new RuntimeEventBus(build, 50);
    const events: unknown[] = [];
    bus.subscribe((event) => events.push(event));

    bus.notifyChanged();
    bus.notifyChanged();
    expect(events).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(50);
    expect(events).toHaveLength(1);
    expect(build).toHaveBeenCalledTimes(1);

    bus.publishSnapshotNow();
    expect(events).toHaveLength(2);

    vi.useRealTimers();
  });
});
