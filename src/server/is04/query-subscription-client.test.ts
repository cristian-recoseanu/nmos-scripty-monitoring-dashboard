import { describe, expect, it, vi } from "vitest";

import { createLogger } from "@/server/logging";
import {
  QueryHttpClient,
  QuerySubscriptionClient,
  type WebSocketLike,
} from "@/server/is04";

function createMockSocket(): WebSocketLike & {
  trigger: (type: string, event?: Record<string, unknown>) => void;
  listeners: Map<string, Array<(event: Record<string, unknown>) => void>>;
} {
  const listeners = new Map<
    string,
    Array<(event: Record<string, unknown>) => void>
  >();

  return {
    readyState: 0,
    listeners,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener as (event: Record<string, unknown>) => void);
      listeners.set(type, list);
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      listeners.set(
        type,
        list.filter((entry) => entry !== listener),
      );
    },
    trigger(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    },
  };
}

describe("QuerySubscriptionClient", () => {
  const logger = createLogger({ level: "silent", pretty: false });

  it("creates a subscription and emits parsed grains", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          id: "sub-nodes",
          ws_href: "ws://registry/ws/nodes",
          max_update_rate_ms: 100,
          resource_path: "/nodes",
          params: {},
          persist: false,
          secure: false,
        }),
    });

    const http = new QueryHttpClient({
      baseUrl: "http://registry:3211/x-nmos/query/v1.3",
      logger,
      fetchImpl,
    });

    const socket = createMockSocket();
    const client = new QuerySubscriptionClient({
      http,
      logger,
      secureWs: false,
      webSocketFactory: () => socket,
      reconnectBaseMs: 10,
      reconnectMaxMs: 20,
    });

    const grains: unknown[] = [];
    client.on("grains", (events) => grains.push(events));

    await client.subscribe("/nodes");
    socket.readyState = 1;
    socket.trigger("open");
    socket.trigger("message", {
      data: JSON.stringify({
        grain: {
          topic: "/nodes/",
          data: [{ path: "node-1", post: { id: "node-1", label: "N1" } }],
        },
      }),
    });

    expect(grains).toHaveLength(1);
    expect(grains[0]).toEqual([
      expect.objectContaining({
        kind: "added",
        resourceId: "node-1",
        resourcePath: "/nodes",
      }),
    ]);

    await client.stop();
  });

  it("schedules reconnect after close", async () => {
    vi.useFakeTimers();

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          id: "sub-devices",
          ws_href: "ws://registry/ws/devices",
          max_update_rate_ms: 100,
          resource_path: "/devices",
          params: {},
          persist: false,
          secure: false,
        }),
    });

    const http = new QueryHttpClient({
      baseUrl: "http://registry:3211/x-nmos/query/v1.3",
      logger,
      fetchImpl,
    });

    const sockets: ReturnType<typeof createMockSocket>[] = [];
    const client = new QuerySubscriptionClient({
      http,
      logger,
      secureWs: false,
      webSocketFactory: () => {
        const socket = createMockSocket();
        sockets.push(socket);
        return socket;
      },
      reconnectBaseMs: 100,
      reconnectMaxMs: 1000,
    });

    await client.subscribe("/devices");
    expect(sockets).toHaveLength(1);

    sockets[0].trigger("close");
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets.length).toBeGreaterThanOrEqual(2);

    await client.stop();
    vi.useRealTimers();
  });

  it("subscribeAll creates each path and ignores bad grain payloads", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      const path = String(url).includes("nodes") ? "/nodes" : "/sources";
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: `sub-${path}`,
            ws_href: `ws://registry/ws${path}`,
            max_update_rate_ms: 100,
            resource_path: path,
            params: {},
            persist: false,
            secure: false,
          }),
      };
    });

    const http = new QueryHttpClient({
      baseUrl: "http://registry:3211/x-nmos/query/v1.3",
      logger,
      fetchImpl,
    });

    const socket = createMockSocket();
    const client = new QuerySubscriptionClient({
      http,
      logger,
      secureWs: false,
      webSocketFactory: () => socket,
    });

    await client.subscribeAll(["/nodes", "/sources"]);
    await client.subscribe("/nodes"); // already active

    socket.trigger("message", { data: "not-json" });
    socket.trigger("error");

    await client.stop();
  });
});
