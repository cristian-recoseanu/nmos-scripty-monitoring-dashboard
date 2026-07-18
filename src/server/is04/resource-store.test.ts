import { describe, expect, it, vi } from "vitest";

import { ResourceStore, type ResourceStoreEvent } from "@/server/is04";

const node = {
  id: "node-1",
  version: "1:0",
  label: "Node 1",
  description: "",
  href: "http://node",
};

const device = {
  id: "device-1",
  version: "1:0",
  label: "Device 1",
  description: "",
  type: "urn:x-nmos:device:generic",
  node_id: "node-1",
  controls: [
    {
      type: "urn:x-nmos:control:ncp/v1.0",
      href: "ws://device/ncp",
    },
  ],
};

const sender = {
  id: "sender-1",
  version: "1:0",
  label: "Sender 1",
  description: "",
  device_id: "device-1",
  flow_id: "flow-1",
  transport: "urn:x-nmos:transport:rtp",
};

const receiver = {
  id: "receiver-1",
  version: "1:0",
  label: "Receiver 1",
  description: "",
  device_id: "device-1",
  transport: "urn:x-nmos:transport:rtp",
  subscription: { sender_id: "sender-1", active: true },
};

const flow = {
  id: "flow-1",
  version: "1:0",
  label: "Flow 1",
  description: "",
  source_id: "source-1",
  device_id: "device-1",
  format: "urn:x-nmos:format:video",
};

const source = {
  id: "source-1",
  version: "1:0",
  label: "Source 1",
  description: "",
  device_id: "device-1",
  format: "urn:x-nmos:format:video",
};

describe("ResourceStore", () => {
  it("applies add / modify / remove grains and maintains indexes", () => {
    const store = new ResourceStore();
    const events: ResourceStoreEvent[] = [];
    store.on("change", (event: ResourceStoreEvent) => events.push(event));

    store.applyGrains([
      {
        kind: "added",
        resourceId: node.id,
        topic: "/nodes/",
        resourcePath: "/nodes",
        post: node,
      },
      {
        kind: "sync",
        resourceId: device.id,
        topic: "/devices/",
        resourcePath: "/devices",
        pre: device,
        post: device,
      },
      {
        kind: "added",
        resourceId: sender.id,
        topic: "/senders/",
        resourcePath: "/senders",
        post: sender,
      },
      {
        kind: "added",
        resourceId: receiver.id,
        topic: "/receivers/",
        resourcePath: "/receivers",
        post: receiver,
      },
      {
        kind: "added",
        resourceId: flow.id,
        topic: "/flows/",
        resourcePath: "/flows",
        post: flow,
      },
      {
        kind: "added",
        resourceId: source.id,
        topic: "/sources/",
        resourcePath: "/sources",
        post: source,
      },
    ]);

    expect(store.listNodes()).toHaveLength(1);
    expect(store.getDevicesForNode("node-1")).toEqual([device]);
    expect(store.getSendersForDevice("device-1")).toEqual([sender]);
    expect(store.getReceiversForDevice("device-1")).toEqual([receiver]);
    expect(store.getConnectedSender("receiver-1")).toEqual(sender);
    expect(store.resolveSenderFlowAndSource("sender-1")).toEqual({
      sender,
      flow,
      source,
    });

    store.applyGrains([
      {
        kind: "modified",
        resourceId: device.id,
        topic: "/devices/",
        resourcePath: "/devices",
        pre: device,
        post: { ...device, label: "Device 1b" },
      },
    ]);

    expect(store.getDevice("device-1")?.label).toBe("Device 1b");
    expect(events.some((event) => event.type === "resource.updated")).toBe(
      true,
    );

    store.applyGrains([
      {
        kind: "removed",
        resourceId: sender.id,
        topic: "/senders/",
        resourcePath: "/senders",
        pre: sender,
      },
    ]);

    expect(store.getSender("sender-1")).toBeUndefined();
    expect(store.getSendersForDevice("device-1")).toEqual([]);
    expect(events.some((event) => event.type === "resource.removed")).toBe(
      true,
    );
  });

  it("resolves connected sender only when subscription is active", () => {
    const store = new ResourceStore();
    store.upsert("sender", sender);
    store.upsert("receiver", {
      ...receiver,
      subscription: { sender_id: "sender-1", active: false },
    });

    expect(store.getConnectedSender("receiver-1")).toBeUndefined();

    store.upsert("receiver", {
      ...receiver,
      subscription: { sender_id: null, active: true },
    });
    expect(store.getConnectedSender("receiver-1")).toBeUndefined();
  });

  it("clears monitor bindings when senders/receivers are removed", () => {
    const store = new ResourceStore();
    store.upsert("sender", sender);
    store.setMonitorBinding("sender-1", {
      deviceId: "device-1",
      monitorOid: 11,
      health: "healthy",
    });
    expect(store.getMonitorBinding("sender-1")?.monitorOid).toBe(11);

    store.remove("sender", "sender-1");
    expect(store.getMonitorBinding("sender-1")).toBeUndefined();
  });

  it("uses fallback resource path when grain topic is unknown", () => {
    const store = new ResourceStore();
    const added = vi.fn();
    store.on("change", added);

    store.applyGrains(
      [
        {
          kind: "added",
          resourceId: "node-2",
          topic: "/unknown/",
          resourcePath: null,
          post: { ...node, id: "node-2" },
        },
      ],
      "/nodes",
    );

    expect(store.getNode("node-2")).toBeDefined();
  });

  it("covers list helpers, clear, and device/node reindex", () => {
    const store = new ResourceStore();
    store.upsert("node", node);
    store.upsert("device", device);
    store.upsert("sender", sender);
    store.upsert("receiver", receiver);
    store.upsert("flow", flow);
    store.upsert("source", source);

    expect(store.listDevices()).toHaveLength(1);
    expect(store.listSenders()).toHaveLength(1);
    expect(store.listReceivers()).toHaveLength(1);
    expect(store.getFlow("flow-1")).toEqual(flow);
    expect(store.getSource("source-1")).toEqual(source);
    expect(store.resolveSenderFlowAndSource("missing")).toBeUndefined();
    expect(store.getDevicesForNode("missing")).toEqual([]);
    expect(store.getSendersForDevice("missing")).toEqual([]);
    expect(store.getReceiversForDevice("missing")).toEqual([]);

    store.upsert("device", { ...device, node_id: "node-2", label: "moved" });
    expect(store.getDevicesForNode("node-1")).toEqual([]);

    store.remove("device", "device-1");
    store.remove("receiver", "receiver-1");
    store.remove("flow", "flow-1");
    store.remove("source", "source-1");
    store.remove("node", "node-1");
    store.remove("node", "missing");

    store.clear();
    expect(store.listNodes()).toEqual([]);
  });

  it("ignores grains without a usable path or payload", () => {
    const store = new ResourceStore();
    store.applyGrains([
      {
        kind: "added",
        resourceId: "x",
        topic: "/unknown/",
        resourcePath: null,
        post: { id: "x" },
      },
    ]);
    store.applyGrains([
      {
        kind: "added",
        resourceId: "x",
        topic: "/nodes/",
        resourcePath: "/nodes",
      },
    ]);
    store.applyGrains([
      {
        kind: "removed",
        resourceId: "missing",
        topic: "/nodes/",
        resourcePath: "/nodes",
        pre: node,
      },
    ]);
    expect(store.listNodes()).toEqual([]);
  });
});
