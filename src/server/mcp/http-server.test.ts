import { afterEach, describe, expect, it } from "vitest";

import { getRootLogger } from "@/server/logging";
import { ResourceStore } from "@/server/is04";
import type { MonitorState } from "@/server/monitoring";
import type { Is05CacheEntry } from "@/server/is05/types";
import {
  startMcpHttpServer,
  type McpHttpServerHandle,
} from "@/server/mcp/http-server";
import type { McpContext } from "@/server/mcp/context";
import {
  buildSelectionDetail,
  buildSystemSnapshot,
} from "@/server/domain/snapshot";

function seedContext(): McpContext {
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
    controls: [],
  });
  store.upsert("sender", {
    id: "sender-1",
    version: "1:0",
    label: "Sender",
    description: "",
    device_id: "device-1",
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
    [
      "receiver-1",
      {
        deviceId: "device-1",
        kind: "receiver",
        oid: 1,
        role: "mon",
        classId: [1, 2, 2, 1],
        resourceId: "receiver-1",
        overallStatus: 3,
        health: "unhealthy",
        lastUpdated: Date.now(),
      },
    ],
  ]);
  const is05 = new Map<string, Is05CacheEntry>();

  const options = {
    store,
    getMonitor: (id: string) => monitors.get(id),
    getDeviceNcpStatus: () => ({
      deviceId: "device-1",
      availability: "available" as const,
      connected: true,
    }),
    getIs05: (id: string) => is05.get(id),
    isAcknowledged: () => false,
    registryConnected: true,
    queryApiBaseUrl: "http://reg/x-nmos/query/v1.3",
  };

  return {
    getSnapshot: () => buildSystemSnapshot(options),
    getDetail: (kind, id) => buildSelectionDetail(kind, id, options),
    getStatus: () => ({
      started: true,
      registry: {
        connected: true,
        queryApiBaseUrl: options.queryApiBaseUrl,
        connectedPaths: [],
        retrying: false,
      },
    }),
    getStore: () => store,
    getMonitor: options.getMonitor,
    getDeviceNcpStatus: options.getDeviceNcpStatus,
    getIs05: options.getIs05,
    isAcknowledged: () => false,
    logger: getRootLogger(),
  };
}

async function mcpRpc(
  url: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

describe("MCP HTTP server", () => {
  let handle: McpHttpServerHandle | undefined;

  afterEach(async () => {
    await handle?.stop();
    handle = undefined;
  });

  it("does not start when called with enabled false (guard)", async () => {
    await expect(
      startMcpHttpServer({
        config: {
          enabled: false,
          host: "127.0.0.1",
          port: 0,
          path: "/mcp",
        },
        context: seedContext(),
        logger: getRootLogger(),
      }),
    ).rejects.toThrow(/mcp.enabled is false/);
  });

  it("serves initialize, tools/list, and tools/call over Streamable HTTP", async () => {
    handle = await startMcpHttpServer({
      config: {
        enabled: true,
        host: "127.0.0.1",
        port: 0,
        path: "/mcp",
      },
      context: seedContext(),
      logger: getRootLogger(),
    });

    const init = await mcpRpc(handle.url, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "vitest", version: "0.0.0" },
      },
    });
    expect(
      (init.result as { serverInfo?: { name?: string } })?.serverInfo?.name,
    ).toBe("nmos-scripty-monitoring");

    const listed = await mcpRpc(handle.url, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const tools = (listed.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_system_overview",
        "list_problems",
        "get_receiver",
        "get_sender",
        "get_connection",
        "summarise_entity",
      ]),
    );

    const called = await mcpRpc(handle.url, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_system_overview", arguments: {} },
    });
    const content = (
      called.result as { content: Array<{ type: string; text: string }> }
    ).content;
    expect(content[0]?.type).toBe("text");
    expect(JSON.parse(content[0]!.text).nodeCount).toBe(1);

    for (const [id, name, args] of [
      [4, "list_nodes", {}],
      [5, "get_node", { id: "node-1" }],
      [6, "list_devices", {}],
      [7, "get_device", { id: "device-1" }],
      [8, "list_senders", {}],
      [9, "list_receivers", { health: "unhealthy" }],
      [10, "get_sender", { id: "sender-1" }],
      [11, "get_receiver", { id: "receiver-1" }],
      [12, "get_connection", { receiver_id: "receiver-1" }],
      [13, "list_problems", {}],
      [14, "summarise_entity", { kind: "system" }],
      [15, "summarise_entity", { kind: "receiver", id: "receiver-1" }],
    ] as const) {
      const result = await mcpRpc(handle.url, {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      });
      expect(result.error).toBeUndefined();
      expect(
        (result.result as { content: unknown[] }).content.length,
      ).toBeGreaterThan(0);
    }

    const getDenied = await fetch(handle.url, { method: "GET" });
    expect(getDenied.status).toBe(405);
  });
});
