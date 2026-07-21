import { describe, expect, it, vi } from "vitest";

import { ResourceStore } from "@/server/is04";
import { createLogger } from "@/server/logging";
import { Is05Orchestrator } from "@/server/is05";

const logger = createLogger({ level: "silent", pretty: false });

function seedStore(store: ResourceStore) {
  store.upsert("device", {
    id: "device-1",
    version: "1:0",
    label: "Device",
    description: "",
    type: "urn:x-nmos:device:generic",
    node_id: "node-1",
    controls: [
      {
        type: "urn:x-nmos:control:sr-ctrl/v1.1",
        href: "http://device/x-nmos/connection/v1.1/",
      },
    ],
  });
  store.upsert("sender", {
    id: "sender-1",
    version: "1:0",
    label: "Sender",
    description: "",
    device_id: "device-1",
    flow_id: null,
    transport: "urn:x-nmos:transport:rtp",
  });
  store.upsert("receiver", {
    id: "receiver-1",
    version: "1:0",
    label: "Receiver",
    description: "",
    device_id: "device-1",
    transport: "urn:x-nmos:transport:rtp",
    subscription: { sender_id: null, active: false },
  });
}

describe("Is05Orchestrator", () => {
  it("harvests on start and on version bump; skips unchanged versions", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes("/senders/") && href.endsWith("/active")) {
        return new Response(
          JSON.stringify({
            receiver_id: null,
            master_enable: true,
            activation: {},
            transport_params: [{ rtp_enabled: true }],
          }),
          { status: 200 },
        );
      }
      if (href.includes("/transportfile")) {
        return new Response("v=0", {
          status: 200,
          headers: { "Content-Type": "application/sdp" },
        });
      }
      if (href.includes("/receivers/") && href.endsWith("/active")) {
        return new Response(
          JSON.stringify({
            sender_id: null,
            master_enable: false,
            activation: {},
            transport_file: { data: null, type: null },
            transport_params: [],
          }),
          { status: 200 },
        );
      }
      return new Response("nope", { status: 404 });
    });

    const store = new ResourceStore();
    seedStore(store);
    const orch = new Is05Orchestrator({
      store,
      logger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      concurrency: 2,
    });

    orch.start();
    await vi.waitFor(() => {
      expect(orch.get("sender-1")?.status).toBe("available");
      expect(orch.get("receiver-1")?.status).toBe("available");
    });

    const callsAfterStart = fetchImpl.mock.calls.length;

    store.upsert("sender", {
      id: "sender-1",
      version: "1:0",
      label: "Sender",
      description: "same version",
      device_id: "device-1",
      flow_id: null,
      transport: "urn:x-nmos:transport:rtp",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchImpl.mock.calls.length).toBe(callsAfterStart);

    store.upsert("sender", {
      id: "sender-1",
      version: "2:0",
      label: "Sender",
      description: "bumped",
      device_id: "device-1",
      flow_id: null,
      transport: "urn:x-nmos:transport:rtp",
    });
    await vi.waitFor(() => {
      expect(orch.get("sender-1")?.sourceIs04Version).toBe("2:0");
    });
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(callsAfterStart);

    store.remove("sender", "sender-1");
    expect(orch.get("sender-1")).toBeUndefined();

    await orch.stop();
  });

  it("marks non-RTP and missing sr-ctrl appropriately", async () => {
    const store = new ResourceStore();
    store.upsert("device", {
      id: "device-1",
      version: "1:0",
      label: "Device",
      description: "",
      type: "urn:x-nmos:device:generic",
      node_id: "node-1",
      controls: [],
    });
    store.upsert("sender", {
      id: "ws-sender",
      version: "1:0",
      label: "WS",
      description: "",
      device_id: "device-1",
      flow_id: null,
      transport: "urn:x-nmos:transport:websocket",
    });
    store.upsert("sender", {
      id: "rtp-sender",
      version: "1:0",
      label: "RTP",
      description: "",
      device_id: "device-1",
      flow_id: null,
      transport: "urn:x-nmos:transport:rtp",
    });

    const orch = new Is05Orchestrator({
      store,
      logger,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    orch.start();
    await vi.waitFor(() => {
      expect(orch.get("ws-sender")?.status).toBe("skipped");
      expect(orch.get("rtp-sender")?.status).toBe("unavailable");
    });
    await orch.stop();
  });
});
