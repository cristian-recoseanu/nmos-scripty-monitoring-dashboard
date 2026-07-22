import { describe, expect, it, vi } from "vitest";

import { createLogger } from "@/server/logging";
import {
  Is12Session,
  MessageType,
  type WebSocketLike,
} from "@/server/is12";
import {
  MonitorCache,
  getLatePacketCounters,
  getTransmissionErrorCounters,
  resetCountersAndMessages,
  resolveMonitorTouchpoint,
  PROP_OVERALL_STATUS,
  PROP_OVERALL_STATUS_MESSAGE,
  PROP_STATUS_REPORTING_DELAY,
  PROP_AUTO_RESET_COUNTERS,
  PROP_LINK_STATUS,
  PROP_LINK_STATUS_MESSAGE,
  PROP_LINK_STATUS_TRANSITION_COUNTER,
  PROP_CONNECTION_OR_TRANSMISSION_STATUS,
  PROP_CONNECTION_OR_TRANSMISSION_STATUS_MESSAGE,
  PROP_CONNECTION_OR_TRANSMISSION_TRANSITION_COUNTER,
  PROP_EXTERNAL_SYNC_STATUS,
  PROP_EXTERNAL_SYNC_STATUS_MESSAGE,
  PROP_EXTERNAL_SYNC_TRANSITION_COUNTER,
  PROP_SYNC_SOURCE_ID,
  PROP_STREAM_OR_ESSENCE_STATUS,
  PROP_STREAM_OR_ESSENCE_STATUS_MESSAGE,
  PROP_STREAM_OR_ESSENCE_TRANSITION_COUNTER,
  METHOD_GET_LATE_PACKET_COUNTERS,
  METHOD_GET_TRANSMISSION_ERROR_COUNTERS,
  METHOD_SENDER_RESET_COUNTERS,
  type NcElementId,
} from "@/server/monitoring";

function createMockSocket(
  respond: (command: {
    handle: number;
    methodId: NcElementId;
    arguments?: Record<string, unknown>;
  }) => { status: number; value?: unknown },
): WebSocketLike & {
  trigger: (type: string, event?: Record<string, unknown>) => void;
} {
  const listeners = new Map<
    string,
    Array<(event: Record<string, unknown>) => void>
  >();

  return {
    readyState: 0,
    send(data: string) {
      const message = JSON.parse(data) as {
        messageType: number;
        commands?: Array<{
          handle: number;
          methodId: NcElementId;
          arguments?: Record<string, unknown>;
        }>;
      };
      if (message.messageType !== MessageType.Command) {
        return;
      }
      for (const command of message.commands ?? []) {
        const result = respond(command);
        for (const listener of listeners.get("message") ?? []) {
          listener({
            data: JSON.stringify({
              messageType: MessageType.CommandResponse,
              responses: [{ handle: command.handle, result }],
            }),
          });
        }
      }
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
  respond: (command: {
    handle: number;
    methodId: NcElementId;
    arguments?: Record<string, unknown>;
  }) => { status: number; value?: unknown },
) {
  const logger = createLogger({ level: "silent", pretty: false });
  let socket = createMockSocket(respond);
  const session = new Is12Session({
    href: "ws://x",
    deviceId: "d1",
    logger,
    webSocketFactory: () => {
      socket = createMockSocket(respond);
      return socket;
    },
  });
  session.connect();
  socket.readyState = 1;
  socket.trigger("open");
  return { session, socket };
}

describe("MonitorCache notifications", () => {
  it("applies all subscribed property notifications", async () => {
    const { session } = openSession(() => ({ status: 200, value: null }));
    const cache = new MonitorCache();
    await cache.loadMonitor(
      session,
      "d1",
      {
        kind: "sender",
        oid: 11,
        role: "SenderMonitor_01",
        classId: [1, 2, 2, 2],
      },
      { monitorOid: 11, resourceType: "sender", resourceId: "s1" },
    );

    const updates: Array<[NcElementId, unknown]> = [
      [PROP_OVERALL_STATUS, 0],
      [PROP_OVERALL_STATUS_MESSAGE, "idle"],
      [PROP_STATUS_REPORTING_DELAY, 3],
      [PROP_AUTO_RESET_COUNTERS, false],
      [PROP_LINK_STATUS, 1],
      [PROP_LINK_STATUS_MESSAGE, "up"],
      [PROP_LINK_STATUS_TRANSITION_COUNTER, 2],
      [PROP_CONNECTION_OR_TRANSMISSION_STATUS, 1],
      [PROP_CONNECTION_OR_TRANSMISSION_STATUS_MESSAGE, "tx ok"],
      [PROP_CONNECTION_OR_TRANSMISSION_TRANSITION_COUNTER, 1],
      [PROP_EXTERNAL_SYNC_STATUS, 1],
      [PROP_EXTERNAL_SYNC_STATUS_MESSAGE, "locked"],
      [PROP_EXTERNAL_SYNC_TRANSITION_COUNTER, 0],
      [PROP_SYNC_SOURCE_ID, "PTP"],
      [PROP_STREAM_OR_ESSENCE_STATUS, 1],
      [PROP_STREAM_OR_ESSENCE_STATUS_MESSAGE, "valid"],
      [PROP_STREAM_OR_ESSENCE_TRANSITION_COUNTER, 4],
    ];

    for (const [propertyId, value] of updates) {
      cache.applyNotification(
        {
          oid: 11,
          eventId: { level: 1, index: 1 },
          eventData: { propertyId, value },
        },
        "d1",
      );
    }

    const state = cache.get("d1", 11)!;
    expect(state.health).toBe("inactive");
    expect(state.overallStatusMessage).toBe("idle");
    expect(state.statusReportingDelay).toBe(3);
    expect(state.autoResetCountersAndMessages).toBe(false);
    expect(state.link).toMatchObject({
      status: 1,
      message: "up",
      transitionCounter: 2,
    });
    expect(state.connectivity?.message).toBe("tx ok");
    expect(state.externalSync?.message).toBe("locked");
    expect(state.synchronizationSourceId).toBe("PTP");
    expect(state.streamOrEssence?.transitionCounter).toBe(4);

    cache.clearDevice("d1");
    expect(cache.listForDevice("d1")).toEqual([]);
    expect(cache.listAll()).toEqual([]);

    await session.stop();
  });

  it("isolates monitors that share the same OID across devices", async () => {
    const { session: sessionA } = openSession(() => ({ status: 200, value: 1 }));
    const { session: sessionB } = openSession(() => ({ status: 200, value: 3 }));
    const cache = new MonitorCache();

    await cache.loadMonitor(
      sessionA,
      "device-a",
      {
        kind: "sender",
        oid: 10,
        role: "Sender_A",
        classId: [1, 2, 2, 2],
      },
      { monitorOid: 10, resourceType: "sender", resourceId: "sender-a" },
    );
    await cache.loadMonitor(
      sessionB,
      "device-b",
      {
        kind: "sender",
        oid: 10,
        role: "Sender_B",
        classId: [1, 2, 2, 2],
      },
      { monitorOid: 10, resourceType: "sender", resourceId: "sender-b" },
    );

    expect(cache.getByResourceId("sender-a")?.deviceId).toBe("device-a");
    expect(cache.getByResourceId("sender-b")?.deviceId).toBe("device-b");
    expect(cache.getByResourceId("sender-a")?.health).toBe("healthy");
    expect(cache.getByResourceId("sender-b")?.health).toBe("unhealthy");

    cache.clearDevice("device-b");
    expect(cache.getByResourceId("sender-a")?.resourceId).toBe("sender-a");
    expect(cache.getByResourceId("sender-b")).toBeUndefined();

    await sessionA.stop();
    await sessionB.stop();
  });

  it("skips unchanged property notifications", async () => {
    const { session } = openSession(() => ({ status: 200, value: 1 }));
    const cache = new MonitorCache();
    await cache.loadMonitor(
      session,
      "d1",
      {
        kind: "sender",
        oid: 11,
        role: "SenderMonitor_01",
        classId: [1, 2, 2, 2],
      },
      { monitorOid: 11, resourceType: "sender", resourceId: "s1" },
    );

    const updates: unknown[] = [];
    cache.on("updated", (state) => updates.push(state));

    cache.applyNotification(
      {
        oid: 11,
        eventId: { level: 1, index: 1 },
        eventData: { propertyId: PROP_OVERALL_STATUS, value: 1 },
      },
      "d1",
    );
    expect(updates).toHaveLength(0);

    cache.applyNotification(
      {
        oid: 11,
        eventId: { level: 1, index: 1 },
        eventData: { propertyId: PROP_OVERALL_STATUS, value: 3 },
      },
      "d1",
    );
    expect(updates).toHaveLength(1);
    expect(cache.get("d1", 11)?.health).toBe("unhealthy");

    await session.stop();
  });
});

describe("monitor control sender paths", () => {
  it("fetches late/transmission counters and resets sender monitors", async () => {
    const { session } = openSession((command) => {
      if (
        command.methodId.level === METHOD_GET_LATE_PACKET_COUNTERS.level &&
        command.methodId.index === METHOD_GET_LATE_PACKET_COUNTERS.index
      ) {
        return { status: 200, value: [{ name: "late", value: 1 }] };
      }
      if (
        command.methodId.level ===
          METHOD_GET_TRANSMISSION_ERROR_COUNTERS.level &&
        command.methodId.index === METHOD_GET_TRANSMISSION_ERROR_COUNTERS.index
      ) {
        return { status: 200, value: [{ name: "tx", value: 9 }] };
      }
      if (
        command.methodId.level === METHOD_SENDER_RESET_COUNTERS.level &&
        command.methodId.index === METHOD_SENDER_RESET_COUNTERS.index
      ) {
        return { status: 200 };
      }
      return { status: 200, value: null };
    });

    expect(await getLatePacketCounters(session, "d1", 10)).toMatchObject({
      counters: [{ name: "late", value: 1 }],
    });
    expect(
      await getTransmissionErrorCounters(session, "d1", 11),
    ).toMatchObject({
      counters: [{ name: "tx", value: 9 }],
    });
    await resetCountersAndMessages(session, "sender", 11);
    await session.stop();
  });
});

describe("resolveMonitorTouchpoint", () => {
  it("loads touchpoints over IS-12", async () => {
    const logger = createLogger({ level: "silent", pretty: false });
    const { session } = openSession(() => ({
      status: 200,
      value: [
        {
          contextNamespace: "x-nmos",
          resource: { resourceType: "sender", id: "sender-9" },
        },
      ],
    }));

    const link = await resolveMonitorTouchpoint(
      session,
      11,
      "sender",
      logger,
    );
    expect(link).toEqual({
      monitorOid: 11,
      resourceType: "sender",
      resourceId: "sender-9",
    });
    await session.stop();
  });
});
