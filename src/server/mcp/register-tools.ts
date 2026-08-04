import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { McpContext } from "@/server/mcp/context";
import {
  connectionInputSchema,
  getConnection,
  getDevice,
  getNode,
  getReceiver,
  getSender,
  getSystemOverview,
  idSchema,
  leafDeepDiveSchema,
  listDevices,
  listDevicesSchema,
  listFilterSchema,
  listNodes,
  listProblems,
  listReceivers,
  listSenders,
  scopeSchema,
  summariseEntity,
  summariseSchema,
} from "@/server/mcp/tools";

function withLogging<Args extends Record<string, unknown>>(
  ctx: McpContext,
  toolName: string,
  handler: (args: Args) => CallToolResult,
): (args: Args) => Promise<CallToolResult> {
  return async (args: Args) => {
    const started = Date.now();
    try {
      const result = handler(args);
      ctx.logger.debug(
        {
          component: "mcp",
          tool: toolName,
          args,
          durationMs: Date.now() - started,
        },
        "MCP tool completed",
      );
      return result;
    } catch (error) {
      ctx.logger.error(
        {
          component: "mcp",
          tool: toolName,
          args,
          err: error,
          durationMs: Date.now() - started,
        },
        "MCP tool failed",
      );
      throw error;
    }
  };
}

/** Build a fresh McpServer with investigation tools bound to `ctx`. */
export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({
    name: "nmos-scripty-monitoring",
    version: "0.1.0",
  });

  server.registerTool(
    "get_system_overview",
    {
      description:
        "System health overview: bubbled health, transition totals, resource health counts, registry status, and worst contributing nodes.",
    },
    withLogging(ctx, "get_system_overview", () => getSystemOverview(ctx)),
  );

  server.registerTool(
    "list_nodes",
    {
      description: "List IS-04 nodes with bubbled health and ack state.",
      inputSchema: { limit: listFilterSchema.shape.limit },
    },
    withLogging(ctx, "list_nodes", (args) => listNodes(ctx, args ?? {})),
  );

  server.registerTool(
    "get_node",
    {
      description: "Get one node: IS-04 fields, bubbled health, contributors, ack.",
      inputSchema: idSchema.shape,
    },
    withLogging(ctx, "get_node", (args) => getNode(ctx, args)),
  );

  server.registerTool(
    "list_devices",
    {
      description:
        "List devices (optional node_id filter) with NCP status, leaf counts, health, ack.",
      inputSchema: listDevicesSchema.shape,
    },
    withLogging(ctx, "list_devices", (args) => listDevices(ctx, args ?? {})),
  );

  server.registerTool(
    "get_device",
    {
      description:
        "Get one device: IS-04, NCP, bubbled health, sender/receiver summaries, ack.",
      inputSchema: idSchema.shape,
    },
    withLogging(ctx, "get_device", (args) => getDevice(ctx, args)),
  );

  server.registerTool(
    "list_senders",
    {
      description:
        "List senders with compact health rows. Filters: device_id, health, acked, has_monitor, format.",
      inputSchema: listFilterSchema.shape,
    },
    withLogging(ctx, "list_senders", (args) => listSenders(ctx, args ?? {})),
  );

  server.registerTool(
    "list_receivers",
    {
      description:
        "List receivers with compact health rows. Filters: device_id, health, acked, has_monitor, format.",
      inputSchema: listFilterSchema.shape,
    },
    withLogging(ctx, "list_receivers", (args) =>
      listReceivers(ctx, args ?? {}),
    ),
  );

  server.registerTool(
    "get_sender",
    {
      description:
        "Deep-dive a sender: IS-04 (+flow/source), IS-05 active (SDP optional), BCP-008 monitor, ack, parent device/node health.",
      inputSchema: leafDeepDiveSchema.shape,
    },
    withLogging(ctx, "get_sender", (args) => getSender(ctx, args)),
  );

  server.registerTool(
    "get_receiver",
    {
      description:
        "Deep-dive a receiver: IS-04 (+connected sender), IS-05 active (SDP optional), BCP-008 monitor, ack, parent device/node health.",
      inputSchema: leafDeepDiveSchema.shape,
    },
    withLogging(ctx, "get_receiver", (args) => getReceiver(ctx, args)),
  );

  server.registerTool(
    "get_connection",
    {
      description:
        "Resolve who is connected to whom for a receiver and/or sender using IS-04 subscription and IS-05 active peer ids; report mismatches.",
      inputSchema: connectionInputSchema.shape,
    },
    withLogging(ctx, "get_connection", (args) => getConnection(ctx, args)),
  );

  server.registerTool(
    "list_problems",
    {
      description:
        "List unhealthy/degraded resources (optional unknown-without-monitor). Scope with node_id / device_id.",
      inputSchema: scopeSchema.shape,
    },
    withLogging(ctx, "list_problems", (args) => listProblems(ctx, args ?? {})),
  );

  server.registerTool(
    "summarise_entity",
    {
      description:
        "Short structured RCA summary for system | node | device | sender | receiver (id required except system).",
      inputSchema: summariseSchema.shape,
    },
    withLogging(ctx, "summarise_entity", (args) =>
      summariseEntity(ctx, args),
    ),
  );

  return server;
}
