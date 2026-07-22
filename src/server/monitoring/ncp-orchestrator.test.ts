import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "@/server/logging";
import { ResourceStore } from "@/server/is04";
import {
  MessageType,
  type WebSocketLike,
} from "@/server/is12";
import {
  NcpOrchestrator,
  resetCounterThrottle,
} from "@/server/monitoring";

function createMockSocket(): WebSocketLike & {
  trigger: (type: string, event?: Record<string, unknown>) => void;
  sent: string[];
} {
  const listeners = new Map<
    string,
    Array<(event: Record<string, unknown>) => void>
  >();
  const sent: string[] = [];

  return {
    readyState: 0,
    sent,
    send(data: string) {
      sent.push(data);
      // Auto-handle common IS-12 flows for orchestrator tests.
      const message = JSON.parse(data) as {
        messageType: number;
        commands?: Array<{
          handle: number;
          oid: number;
          methodId: { level: number; index: number };
          arguments?: { id?: { level: number; index: number } };
        }>;
        subscriptions?: number[];
      };

      queueMicrotask(() => {
        if (message.messageType === MessageType.Subscription) {
          for (const listener of listeners.get("message") ?? []) {
            listener({
              data: JSON.stringify({
                messageType: MessageType.SubscriptionResponse,
                subscriptions: message.subscriptions ?? [],
              }),
            });
          }
          return;
        }

        if (message.messageType !== MessageType.Command) {
          return;
        }

        for (const command of message.commands ?? []) {
          let value: unknown = null;

          // FindMembersByClassId
          if (command.methodId.level === 2 && command.methodId.index === 4) {
            value = [
              {
                role: "ReceiverMonitor_01",
                oid: 10,
                classId: [1, 2, 2, 1],
                userLabel: "Rx",
              },
            ];
          }

          // Get property
          if (command.methodId.level === 1 && command.methodId.index === 1) {
            const id = command.arguments?.id;
            if (id?.level === 1 && id.index === 7) {
              value = [
                {
                  contextNamespace: "x-nmos",
                  resource: {
                    resourceType: "receiver",
                    id: "receiver-1",
                  },
                },
              ];
            } else if (id?.level === 3 && id.index === 1) {
              value = 2; // PartiallyHealthy
            } else if (id?.level === 3 && id.index === 2) {
              value = "link down";
            } else if (id?.level === 4 && id.index === 14) {
              value = true;
            }
          }

          for (const listener of listeners.get("message") ?? []) {
            listener({
              data: JSON.stringify({
                messageType: MessageType.CommandResponse,
                responses: [
                  {
                    handle: command.handle,
                    result: { status: 200, value },
                  },
                ],
              }),
            });
          }
        }
      });
    },
    close: vi.fn(),
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener as (event: Record<string, unknown>) => void);
      listeners.set(type, list);
    },
    removeEventListener() {},
    trigger(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    },
  };
}

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
      href: "ws://127.0.0.1:8080/ncp",
    },
  ],
};

const receiver = {
  id: "receiver-1",
  version: "1:0",
  label: "Rx 1",
  description: "",
  device_id: "device-1",
  transport: "urn:x-nmos:transport:rtp",
  subscription: { sender_id: null, active: false },
};

afterEach(() => {
  resetCounterThrottle();
});

describe("NcpOrchestrator", () => {
  it("opens a session on device add, harvests monitors, and tears down on remove", async () => {
    const logger = createLogger({ level: "silent", pretty: false });
    const store = new ResourceStore();
    const sockets: ReturnType<typeof createMockSocket>[] = [];

    const orchestrator = new NcpOrchestrator({
      store,
      logger,
      webSocketFactory: () => {
        const socket = createMockSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const harvested = new Promise<{ deviceId: string }>((resolve) => {
      orchestrator.on("harvested", resolve);
    });

    orchestrator.start();

    store.upsert("receiver", receiver);
    store.upsert("device", device);

    // Open the socket
    expect(sockets.length).toBeGreaterThanOrEqual(1);
    sockets[0].readyState = 1;
    sockets[0].trigger("open");

    await harvested;

    const status = orchestrator.getDeviceStatus("device-1");
    expect(status?.availability).toBe("available");
    expect(status?.connected).toBe(true);

    const monitor = orchestrator.cache.getByResourceId("receiver-1");
    expect(monitor?.health).toBe("degraded");
    expect(monitor?.overallStatusMessage).toBe("link down");
    expect(store.getMonitorBinding("receiver-1")?.monitorOid).toBe(10);

    // Property notification updates cache
    sockets[0].trigger("message", {
      data: JSON.stringify({
        messageType: MessageType.Notification,
        notifications: [
          {
            oid: 10,
            eventId: { level: 1, index: 1 },
            eventData: {
              propertyId: { level: 3, index: 1 },
              value: 1,
            },
          },
        ],
      }),
    });
    expect(orchestrator.cache.get("device-1", 10)?.health).toBe("healthy");

    const resetAll = await orchestrator.resetAllMonitors();
    expect(resetAll.reset).toBeGreaterThanOrEqual(1);
    expect(resetAll.failures).toEqual([]);
    expect(orchestrator.getOpenSessionCount()).toBe(1);
    expect(orchestrator.listDeviceStatuses()).toHaveLength(1);

    store.remove("device", "device-1");
    await vi.waitFor(() => {
      expect(orchestrator.getDeviceStatus("device-1")).toBeUndefined();
    });
    expect(orchestrator.cache.getByResourceId("receiver-1")).toBeUndefined();

    await orchestrator.stop();
  });

  it("marks devices without NCP as unavailable", async () => {
    const logger = createLogger({ level: "silent", pretty: false });
    const store = new ResourceStore();
    const orchestrator = new NcpOrchestrator({ store, logger });
    orchestrator.start();

    store.upsert("device", {
      ...device,
      controls: [],
    });

    await vi.waitFor(() => {
      expect(orchestrator.getDeviceStatus("device-1")?.availability).toBe(
        "unavailable",
      );
    });

    await orchestrator.stop();
  });

  it("reconnects when NCP href changes", async () => {
    const logger = createLogger({ level: "silent", pretty: false });
    const store = new ResourceStore();
    const sockets: ReturnType<typeof createMockSocket>[] = [];

    const orchestrator = new NcpOrchestrator({
      store,
      logger,
      webSocketFactory: () => {
        const socket = createMockSocket();
        sockets.push(socket);
        return socket;
      },
    });

    orchestrator.start();
    store.upsert("receiver", receiver);
    store.upsert("device", device);
    sockets[0].readyState = 1;
    sockets[0].trigger("open");

    await vi.waitFor(() => {
      expect(orchestrator.cache.getByResourceId("receiver-1")).toBeDefined();
    });

    store.upsert("device", {
      ...device,
      controls: [
        {
          type: "urn:x-nmos:control:ncp/v1.0",
          href: "ws://127.0.0.1:9090/ncp",
        },
      ],
    });

    await vi.waitFor(() => {
      expect(sockets.length).toBeGreaterThanOrEqual(2);
    });
    sockets.at(-1)!.readyState = 1;
    sockets.at(-1)!.trigger("open");

    await vi.waitFor(() => {
      expect(orchestrator.getDeviceStatus("device-1")?.href).toBe(
        "ws://127.0.0.1:9090/ncp",
      );
    });

    await orchestrator.stop();
  });
});
