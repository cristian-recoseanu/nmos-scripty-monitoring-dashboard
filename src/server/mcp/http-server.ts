import type { Server as HttpServer } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { Request, Response } from "express";

import type { AppConfig } from "@/config";
import type { Logger } from "@/server/logging";
import type { McpContext } from "@/server/mcp/context";
import { createMcpServer } from "@/server/mcp/register-tools";

export type McpHttpServerHandle = {
  host: string;
  port: number;
  path: string;
  url: string;
  stop: () => Promise<void>;
};

export type StartMcpHttpServerOptions = {
  config: AppConfig["mcp"];
  context: McpContext;
  logger: Logger;
};

/**
 * Start a Streamable HTTP MCP listener on a dedicated host/port (not the Next.js port).
 * Stateless JSON/SSE responses; DNS-rebinding protection when bound to loopback.
 */
export async function startMcpHttpServer(
  options: StartMcpHttpServerOptions,
): Promise<McpHttpServerHandle> {
  const { config, context, logger } = options;
  if (!config.enabled) {
    throw new Error("startMcpHttpServer called while mcp.enabled is false");
  }

  const path = config.path;
  const app = createMcpExpressApp({ host: config.host });

  const handleMcpPost = async (req: Request, res: Response) => {
    const server = createMcpServer(context);
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      logger.error({ err: error, component: "mcp" }, "MCP request failed");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
      await server.close().catch(() => undefined);
    }
  };

  app.post(path, (req, res) => {
    void handleMcpPost(req, res);
  });

  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  };
  app.get(path, methodNotAllowed);
  app.delete(path, methodNotAllowed);

  const httpServer: HttpServer = await new Promise((resolve, reject) => {
    const server = app.listen(config.port, config.host, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(server);
    });
  });

  const address = httpServer.address();
  const boundPort =
    address && typeof address === "object" ? address.port : config.port;
  const url = `http://${config.host}:${boundPort}${path}`;

  logger.info(
    {
      component: "mcp",
      host: config.host,
      port: boundPort,
      path,
      url,
    },
    "MCP Streamable HTTP server listening (read-only investigation tools)",
  );

  return {
    host: config.host,
    port: boundPort,
    path,
    url,
    stop: async () =>
      new Promise((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          logger.info({ component: "mcp" }, "MCP HTTP server stopped");
          resolve();
        });
      }),
  };
}
