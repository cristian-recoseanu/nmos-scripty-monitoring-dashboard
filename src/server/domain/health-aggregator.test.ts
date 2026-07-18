import { describe, expect, it } from "vitest";

import { ResourceStore } from "@/server/is04";
import type { MonitorState } from "@/server/monitoring";
import { aggregateSystemHealth } from "@/server/domain/health-aggregator";

function monitor(
  partial: Partial<MonitorState> & Pick<MonitorState, "resourceId" | "health" | "kind" | "oid">,
): MonitorState {
  return {
    deviceId: "device-1",
    role: "mon",
    classId: [1, 2, 2, 1],
    lastUpdated: Date.now(),
    ...partial,
  };
}

describe("aggregateSystemHealth", () => {
  it("bubbles worst child health up the tree", () => {
    const store = new ResourceStore();
    store.upsert("node", {
      id: "node-1",
      version: "1:0",
      label: "Node A",
      description: "",
      href: "http://n",
    });
    store.upsert("device", {
      id: "device-1",
      version: "1:0",
      label: "Device A",
      description: "",
      type: "urn:x-nmos:device:generic",
      node_id: "node-1",
    });
    store.upsert("sender", {
      id: "sender-1",
      version: "1:0",
      label: "Tx",
      description: "",
      device_id: "device-1",
      flow_id: null,
      transport: "urn:x-nmos:transport:rtp",
    });
    store.upsert("receiver", {
      id: "receiver-1",
      version: "1:0",
      label: "Rx",
      description: "",
      device_id: "device-1",
      transport: "urn:x-nmos:transport:rtp",
      subscription: { sender_id: null, active: false },
    });

    const monitors = new Map<string, MonitorState>([
      [
        "sender-1",
        monitor({
          resourceId: "sender-1",
          kind: "sender",
          oid: 11,
          health: "healthy",
        }),
      ],
      [
        "receiver-1",
        monitor({
          resourceId: "receiver-1",
          kind: "receiver",
          oid: 10,
          health: "unhealthy",
          overallStatusMessage: "NIC down",
        }),
      ],
    ]);

    const system = aggregateSystemHealth({
      store,
      getMonitor: (id) => monitors.get(id),
      getDeviceNcpStatus: () => ({
        deviceId: "device-1",
        availability: "available",
        connected: true,
      }),
    });

    expect(system.health).toBe("unhealthy");
    expect(system.nodes[0]?.health).toBe("unhealthy");
    expect(system.nodes[0]?.devices[0]?.health).toBe("unhealthy");
    expect(system.worstContributors[0]).toMatchObject({
      kind: "node",
      health: "unhealthy",
    });
    expect(system.nodes[0]?.devices[0]?.worstContributors[0]).toMatchObject({
      kind: "receiver",
      id: "receiver-1",
      message: "NIC down",
    });
  });

  it("uses unknown for leaves without monitors and empty trees", () => {
    const store = new ResourceStore();
    expect(
      aggregateSystemHealth({
        store,
        getMonitor: () => undefined,
        getDeviceNcpStatus: () => undefined,
      }).health,
    ).toBe("unknown");

    store.upsert("node", {
      id: "node-1",
      version: "1:0",
      label: "Solo",
      description: "",
      href: "http://n",
    });

    const system = aggregateSystemHealth({
      store,
      getMonitor: () => undefined,
      getDeviceNcpStatus: () => undefined,
    });
    expect(system.nodes[0]?.health).toBe("unknown");
  });

  it("sorts contributors by severity then label", () => {
    const store = new ResourceStore();
    store.upsert("node", {
      id: "node-1",
      version: "1:0",
      label: "N",
      description: "",
      href: "http://n",
    });
    store.upsert("device", {
      id: "device-1",
      version: "1:0",
      label: "D",
      description: "",
      type: "urn:x-nmos:device:generic",
      node_id: "node-1",
    });
    for (const [id, label, health] of [
      ["r1", "Alpha", "degraded"],
      ["r2", "Beta", "degraded"],
      ["r3", "Zulu", "healthy"],
    ] as const) {
      store.upsert("receiver", {
        id,
        version: "1:0",
        label,
        description: "",
        device_id: "device-1",
        transport: "urn:x-nmos:transport:rtp",
        subscription: { sender_id: null, active: false },
      });
      store.setMonitorBinding(id, {
        deviceId: "device-1",
        monitorOid: 1,
        health,
      });
    }

    const monitors = new Map<string, MonitorState>([
      ["r1", monitor({ resourceId: "r1", kind: "receiver", oid: 1, health: "degraded" })],
      ["r2", monitor({ resourceId: "r2", kind: "receiver", oid: 2, health: "degraded" })],
      ["r3", monitor({ resourceId: "r3", kind: "receiver", oid: 3, health: "healthy" })],
    ]);

    const device = aggregateSystemHealth({
      store,
      getMonitor: (id) => monitors.get(id),
      getDeviceNcpStatus: () => undefined,
    }).nodes[0]!.devices[0]!;

    expect(device.worstContributors.map((c) => c.label)).toEqual([
      "Alpha",
      "Beta",
      "Zulu",
    ]);
  });

  it("groups orphan devices under a synthetic node", () => {
    const store = new ResourceStore();
    store.upsert("device", {
      id: "device-x",
      version: "1:0",
      label: "Orphan device",
      description: "",
      type: "urn:x-nmos:device:generic",
      node_id: "missing-node",
    });

    const system = aggregateSystemHealth({
      store,
      getMonitor: () => undefined,
      getDeviceNcpStatus: () => undefined,
    });

    expect(system.nodes.some((node) => node.id === "__orphans__")).toBe(true);
  });

  it("ignores unknown and inactive when bubbling parent health", () => {
    const store = new ResourceStore();
    store.upsert("node", {
      id: "node-1",
      version: "1:0",
      label: "Node A",
      description: "",
      href: "http://n",
    });
    store.upsert("device", {
      id: "device-1",
      version: "1:0",
      label: "Device A",
      description: "",
      type: "urn:x-nmos:device:generic",
      node_id: "node-1",
    });
    store.upsert("source", {
      id: "source-1",
      version: "1:0",
      label: "Src",
      description: "",
      device_id: "device-1",
      format: "urn:x-nmos:format:video",
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
      label: "Tx",
      description: "",
      device_id: "device-1",
      flow_id: "flow-1",
      transport: "urn:x-nmos:transport:rtp",
    });
    store.upsert("receiver", {
      id: "receiver-1",
      version: "1:0",
      label: "Rx",
      description: "",
      device_id: "device-1",
      transport: "urn:x-nmos:transport:rtp",
      format: "urn:x-nmos:format:audio",
      subscription: { sender_id: null, active: false },
    });

    const monitors = new Map<string, MonitorState>([
      [
        "sender-1",
        monitor({
          resourceId: "sender-1",
          kind: "sender",
          oid: 11,
          health: "healthy",
          link: { transitionCounter: 2 },
          connectivity: { transitionCounter: 1 },
        }),
      ],
      [
        "receiver-1",
        monitor({
          resourceId: "receiver-1",
          kind: "receiver",
          oid: 10,
          health: "unknown",
          link: { transitionCounter: 4 },
        }),
      ],
    ]);

    const system = aggregateSystemHealth({
      store,
      getMonitor: (id) => monitors.get(id),
      getDeviceNcpStatus: () => ({
        deviceId: "device-1",
        availability: "available",
        connected: true,
      }),
    });

    expect(system.health).toBe("healthy");
    expect(system.nodes[0]?.devices[0]?.health).toBe("healthy");
    expect(system.totalTransitions).toBe(7);
    expect(system.nodes[0]?.devices[0]?.totalTransitions).toBe(7);
    expect(system.nodes[0]?.devices[0]?.senders[0]?.format).toBe("video");
    expect(system.nodes[0]?.devices[0]?.receivers[0]?.format).toBe("audio");
  });
});
