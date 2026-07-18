import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "@/server/logging";
import { ResourceStore } from "@/server/is04";
import { Is04Orchestrator } from "@/server/is04/is04-orchestrator";
import { appConfigSchema } from "@/config";
import type { WebSocketLike } from "@/server/is04/query-subscription-client";

function createMockSocket(): WebSocketLike & {
  trigger: (type: string, event?: Record<string, unknown>) => void;
} {
  const listeners = new Map<
    string,
    Array<(event: Record<string, unknown>) => void>
  >();
  return {
    readyState: 0,
    send: vi.fn(),
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

describe("Is04Orchestrator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("subscribes to all resource paths and applies grains to the store", async () => {
    const logger = createLogger({ level: "silent", pretty: false });
    const store = new ResourceStore();
    const sockets: ReturnType<typeof createMockSocket>[] = [];

    let subCounter = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      subCounter += 1;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: `sub-${subCounter}`,
            ws_href: `ws://registry/ws/${subCounter}`,
            max_update_rate_ms: 100,
            resource_path: "/nodes",
            params: {},
            persist: false,
            secure: false,
          }),
      };
    });

    const config = appConfigSchema.parse({
      registry: { host: "127.0.0.1", port: 3211 },
    });

    const orchestrator = new Is04Orchestrator({
      config,
      store,
      logger,
      fetchImpl,
      webSocketFactory: () => {
        const socket = createMockSocket();
        sockets.push(socket);
        return socket;
      },
    });

    await orchestrator.start();
    expect(fetchImpl).toHaveBeenCalled();
    expect(sockets.length).toBeGreaterThanOrEqual(6);

    sockets[0].readyState = 1;
    sockets[0].trigger("open");
    expect(orchestrator.getConnectionState().connected).toBe(true);

    sockets[0].trigger("message", {
      data: JSON.stringify({
        grain: {
          topic: "/nodes/",
          data: [
            {
              path: "node-1",
              post: {
                id: "node-1",
                version: "1:0",
                label: "N1",
                description: "",
                href: "http://n",
              },
            },
          ],
        },
      }),
    });

    expect(store.getNode("node-1")?.label).toBe("N1");

    await orchestrator.stop();
  });

  it("retries subscription setup when the registry is unreachable", async () => {
    vi.useFakeTimers();
    const logger = createLogger({ level: "silent", pretty: false });
    const store = new ResourceStore();

    let calls = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls <= 6) {
        return {
          ok: false,
          status: 503,
          text: async () => "unavailable",
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: `sub-${calls}`,
            ws_href: `ws://registry/ws/${calls}`,
            max_update_rate_ms: 100,
            resource_path: "/nodes",
            params: {},
            persist: false,
            secure: false,
          }),
      };
    });

    const config = appConfigSchema.parse({
      registry: { host: "127.0.0.1", port: 3211 },
    });

    const orchestrator = new Is04Orchestrator({
      config,
      store,
      logger,
      fetchImpl,
      retryBaseMs: 100,
      retryMaxMs: 100,
      webSocketFactory: () => createMockSocket(),
    });

    await orchestrator.start();
    expect(orchestrator.getConnectionState().lastError).toBeTruthy();
    expect(orchestrator.getConnectionState().retrying).toBe(true);

    await vi.advanceTimersByTimeAsync(150);
    // Allow the async ensureSubscriptions microtask to run
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchImpl.mock.calls.length).toBeGreaterThan(6);

    await orchestrator.stop();
    vi.useRealTimers();
  });
});
