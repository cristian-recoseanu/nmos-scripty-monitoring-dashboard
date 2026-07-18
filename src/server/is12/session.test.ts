import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "@/server/logging";
import {
  Is12Session,
  MessageType,
  METHOD_GET,
  type WebSocketLike,
} from "@/server/is12";
import {
  harvestMonitors,
  MonitorCache,
  assertCounterThrottle,
  getLostPacketCounters,
  resetCounterThrottle,
  resetCountersAndMessages,
  setAutoResetCountersAndMessages,
  PROP_OVERALL_STATUS,
  METHOD_GET_LOST_PACKET_COUNTERS,
  METHOD_RECEIVER_RESET_COUNTERS,
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

function openSession(
  handler: (socket: ReturnType<typeof createMockSocket>, raw: string) => void,
): { session: Is12Session; socket: ReturnType<typeof createMockSocket> } {
  const logger = createLogger({ level: "silent", pretty: false });
  let socket = createMockSocket();

  const session = new Is12Session({
    href: "ws://device/ncp",
    deviceId: "device-1",
    logger,
    webSocketFactory: () => {
      socket = createMockSocket();
      // Auto-respond to commands via handler on next tick after send is patched.
      const originalSend = socket.send.bind(socket);
      socket.send = (data: string) => {
        originalSend(data);
        handler(socket, data);
      };
      return socket;
    },
  });

  session.connect();
  socket.readyState = 1;
  socket.trigger("open");
  return { session, socket };
}

afterEach(() => {
  resetCounterThrottle();
});

describe("Is12Session", () => {
  it("correlates command responses by handle", async () => {
    const { session } = openSession((socket, raw) => {
      const message = JSON.parse(raw) as {
        messageType: number;
        commands?: Array<{ handle: number }>;
      };
      if (message.messageType !== MessageType.Command) {
        return;
      }
      socket.trigger("message", {
        data: JSON.stringify({
          messageType: MessageType.CommandResponse,
          responses: message.commands!.map((command) => ({
            handle: command.handle,
            result: { status: 200, value: [1, 2, 2, 1] },
          })),
        }),
      });
    });

    const result = await session.getProperty(10, PROP_OVERALL_STATUS);
    expect(result).toEqual([1, 2, 2, 1]);
    await session.stop();
  });

  it("subscribes and emits subscription response", async () => {
    const { session, socket } = openSession((sock, raw) => {
      const message = JSON.parse(raw) as { messageType: number };
      if (message.messageType === MessageType.Subscription) {
        sock.trigger("message", {
          data: JSON.stringify({
            messageType: MessageType.SubscriptionResponse,
            subscriptions: [10, 11],
          }),
        });
      }
    });

    const subscribed = await session.subscribe([10, 11]);
    expect(subscribed).toEqual([10, 11]);

    const notifications: Array<{ oid: number }> = [];
    session.on("notification", (n: { oid: number }) => notifications.push(n));
    socket.trigger("message", {
      data: JSON.stringify({
        messageType: MessageType.Notification,
        notifications: [
          {
            oid: 10,
            eventId: { level: 1, index: 1 },
            eventData: {
              propertyId: PROP_OVERALL_STATUS,
              value: 3,
            },
          },
        ],
      }),
    });
    expect(notifications).toEqual([{ oid: 10, eventId: expect.anything(), eventData: expect.anything() }]);

    await session.stop();
  });

  it("reconnects and invokes onReady again", async () => {
    vi.useFakeTimers();
    const logger = createLogger({ level: "silent", pretty: false });
    const sockets: ReturnType<typeof createMockSocket>[] = [];
    const ready = vi.fn();

    const session = new Is12Session({
      href: "ws://device/ncp",
      deviceId: "device-1",
      logger,
      reconnectBaseMs: 50,
      reconnectMaxMs: 50,
      webSocketFactory: () => {
        const socket = createMockSocket();
        sockets.push(socket);
        return socket;
      },
      onReady: ready,
    });

    session.connect();
    sockets[0].readyState = 1;
    sockets[0].trigger("open");
    expect(ready).toHaveBeenCalledTimes(1);

    sockets[0].trigger("close");
    await vi.advanceTimersByTimeAsync(50);
    expect(sockets.length).toBeGreaterThanOrEqual(2);
    sockets.at(-1)!.readyState = 1;
    sockets.at(-1)!.trigger("open");
    expect(ready).toHaveBeenCalledTimes(2);

    await session.stop();
    vi.useRealTimers();
  });
});

describe("harvestMonitors", () => {
  it("finds receiver and sender monitors via FindMembersByClassId", async () => {
    const { session } = openSession((socket, raw) => {
      const message = JSON.parse(raw) as {
        messageType: number;
        commands?: Array<{ handle: number; methodId: { level: number; index: number } }>;
      };
      if (message.messageType !== MessageType.Command) {
        return;
      }
      for (const command of message.commands ?? []) {
        socket.trigger("message", {
          data: JSON.stringify({
            messageType: MessageType.CommandResponse,
            responses: [
              {
                handle: command.handle,
                result: {
                  status: 200,
                  value: [
                    {
                      role: "ReceiverMonitor_01",
                      oid: 10,
                      classId: [1, 2, 2, 1],
                      userLabel: "Rx mon",
                    },
                    {
                      role: "SenderMonitor_01",
                      oid: 11,
                      classId: [1, 2, 2, 2],
                      userLabel: "Tx mon",
                    },
                    {
                      role: "Other",
                      oid: 12,
                      classId: [1, 2, 2],
                      userLabel: "generic",
                    },
                  ],
                },
              },
            ],
          }),
        });
      }
    });

    const monitors = await harvestMonitors(session);
    expect(monitors).toHaveLength(2);
    expect(monitors.map((m) => m.kind).sort()).toEqual(["receiver", "sender"]);
    await session.stop();
  });

  it("falls back to recursive members walk", async () => {
    const { session } = openSession((socket, raw) => {
      const message = JSON.parse(raw) as {
        messageType: number;
        commands?: Array<{
          handle: number;
          oid: number;
          methodId: { level: number; index: number };
          arguments?: { id?: { level: number; index: number } };
        }>;
      };
      if (message.messageType !== MessageType.Command) {
        return;
      }

      for (const command of message.commands ?? []) {
        // FindMembersByClassId fails
        if (command.methodId.level === 2 && command.methodId.index === 4) {
          socket.trigger("message", {
            data: JSON.stringify({
              messageType: MessageType.CommandResponse,
              responses: [
                {
                  handle: command.handle,
                  result: { status: 500, errorMessage: "not supported" },
                },
              ],
            }),
          });
          continue;
        }

        // Get members
        if (
          command.methodId.level === 1 &&
          command.methodId.index === 1 &&
          command.arguments?.id?.level === 2 &&
          command.arguments?.id?.index === 2
        ) {
          const value =
            command.oid === 1
              ? [
                  {
                    role: "nested",
                    oid: 5,
                    classId: [1, 1],
                    userLabel: "block",
                  },
                ]
              : [
                  {
                    role: "ReceiverMonitor_01",
                    oid: 10,
                    classId: [1, 2, 2, 1],
                    userLabel: "Rx",
                  },
                ];

          socket.trigger("message", {
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

    const monitors = await harvestMonitors(session);
    expect(monitors).toEqual([
      expect.objectContaining({ oid: 10, kind: "receiver" }),
    ]);
    await session.stop();
  });
});

describe("MonitorCache", () => {
  it("loads properties and applies notifications", async () => {
    const { session } = openSession((socket, raw) => {
      const message = JSON.parse(raw) as {
        messageType: number;
        commands?: Array<{
          handle: number;
          arguments?: { id?: { level: number; index: number } };
        }>;
      };
      if (message.messageType !== MessageType.Command) {
        return;
      }
      for (const command of message.commands ?? []) {
        const id = command.arguments?.id;
        let value: unknown = null;
        if (id?.level === 3 && id.index === 1) {
          value = 1; // Healthy
        }
        if (id?.level === 3 && id.index === 2) {
          value = "ok";
        }
        if (id?.level === 1 && id.index === 7) {
          value = [
            {
              contextNamespace: "x-nmos",
              resource: { resourceType: "receiver", id: "rx-1" },
            },
          ];
        }
        socket.trigger("message", {
          data: JSON.stringify({
            messageType: MessageType.CommandResponse,
            responses: [
              { handle: command.handle, result: { status: 200, value } },
            ],
          }),
        });
      }
    });

    const cache = new MonitorCache();
    const state = await cache.loadMonitor(
      session,
      "device-1",
      {
        kind: "receiver",
        oid: 10,
        role: "ReceiverMonitor_01",
        classId: [1, 2, 2, 1],
      },
      {
        monitorOid: 10,
        resourceType: "receiver",
        resourceId: "rx-1",
      },
    );

    expect(state.health).toBe("healthy");
    expect(state.overallStatusMessage).toBe("ok");
    expect(cache.getByResourceId("rx-1")?.oid).toBe(10);

    cache.applyNotification({
      oid: 10,
      eventId: { level: 1, index: 1 },
      eventData: {
        propertyId: PROP_OVERALL_STATUS,
        value: 3,
      },
    });
    expect(cache.get(10)?.health).toBe("unhealthy");

    await session.stop();
  });
});

describe("monitor-control", () => {
  it("invokes counter / reset / autoReset methods", async () => {
    const invoked: Array<{ method: string; value?: unknown }> = [];

    const { session } = openSession((socket, raw) => {
      const message = JSON.parse(raw) as {
        messageType: number;
        commands?: Array<{
          handle: number;
          methodId: { level: number; index: number };
          arguments?: { id?: { level: number; index: number }; value?: unknown };
        }>;
      };
      if (message.messageType !== MessageType.Command) {
        return;
      }
      for (const command of message.commands ?? []) {
        if (
          command.methodId.level === METHOD_GET_LOST_PACKET_COUNTERS.level &&
          command.methodId.index === METHOD_GET_LOST_PACKET_COUNTERS.index
        ) {
          invoked.push({ method: "GetLostPacketCounters" });
          socket.trigger("message", {
            data: JSON.stringify({
              messageType: MessageType.CommandResponse,
              responses: [
                {
                  handle: command.handle,
                  result: {
                    status: 200,
                    value: [{ name: "lost", value: 3 }],
                  },
                },
              ],
            }),
          });
        } else if (
          command.methodId.level === METHOD_RECEIVER_RESET_COUNTERS.level &&
          command.methodId.index === METHOD_RECEIVER_RESET_COUNTERS.index
        ) {
          invoked.push({ method: "ResetCountersAndMessages" });
          socket.trigger("message", {
            data: JSON.stringify({
              messageType: MessageType.CommandResponse,
              responses: [
                { handle: command.handle, result: { status: 200 } },
              ],
            }),
          });
        } else if (
          command.methodId.level === METHOD_GET.level &&
          command.methodId.index === 2
        ) {
          invoked.push({
            method: "Set",
            value: command.arguments?.value,
          });
          socket.trigger("message", {
            data: JSON.stringify({
              messageType: MessageType.CommandResponse,
              responses: [
                { handle: command.handle, result: { status: 200 } },
              ],
            }),
          });
        }
      }
    });

    const lost = await getLostPacketCounters(session, "device-1", 10);
    expect(lost.counters).toEqual([{ name: "lost", value: 3 }]);

    await resetCountersAndMessages(session, "receiver", 10);
    await setAutoResetCountersAndMessages(session, 10, false);

    expect(invoked.map((i) => i.method)).toEqual([
      "GetLostPacketCounters",
      "ResetCountersAndMessages",
      "Set",
    ]);

    expect(() =>
      assertCounterThrottle("device-1", 10, "GetLostPacketCounters", 1000),
    ).toThrow(/throttled/);

    await session.stop();
  });
});
