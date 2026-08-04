import { z } from "zod";

const booleanFromEnv = z.union([
  z.boolean(),
  z
    .string()
    .transform((value, ctx) => {
      const normalised = value.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(normalised)) {
        return true;
      }
      if (["0", "false", "no", "off", ""].includes(normalised)) {
        return false;
      }
      ctx.addIssue({
        code: "custom",
        message: `Invalid boolean value: ${value}`,
      });
      return z.NEVER;
    }),
]);

const logLevelSchema = z.enum([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

export const appConfigSchema = z.object({
  registry: z.object({
    host: z.string().min(1, "registry.host is required"),
    port: z.coerce.number().int().min(1).max(65535),
    protocol: z.enum(["http", "https"]).default("http"),
    queryApiVersion: z
      .string()
      .regex(/^v\d+(\.\d+)?$/, "queryApiVersion must look like v1.3")
      .default("v1.3"),
    basePath: z.string().default("/x-nmos/query"),
    /** When omitted, derived from protocol (https → true). */
    secureWs: booleanFromEnv.optional(),
  }),
  logLevel: logLevelSchema.default("info"),
  /** Persistent log file path (also writes to stdout). Default: logs/app.log */
  logFile: z.string().min(1).default("logs/app.log"),
  appPort: z.coerce.number().int().min(1).max(65535).default(3000),
  /**
   * Optional MCP (Model Context Protocol) HTTP server for LLM investigation tools.
   * Hard off when `enabled` is false — no listener, no tools registered.
   */
  mcp: z
    .object({
      enabled: booleanFromEnv.default(false),
      /** Bind address; default loopback. Prefer 127.0.0.1 unless you add auth. */
      host: z.string().min(1).default("127.0.0.1"),
      port: z.coerce.number().int().min(1).max(65535).default(3100),
      /** Single Streamable HTTP MCP endpoint path (POST). */
      path: z
        .string()
        .min(1)
        .default("/mcp")
        .transform((value) => (value.startsWith("/") ? value : `/${value}`)),
    })
    .default({
      enabled: false,
      host: "127.0.0.1",
      port: 3100,
      path: "/mcp",
    }),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;

export function buildQueryApiBaseUrl(config: AppConfig): string {
  const { protocol, host, port, basePath, queryApiVersion } = config.registry;
  const normalisedBase = basePath.replace(/\/$/, "");
  return `${protocol}://${host}:${port}${normalisedBase}/${queryApiVersion}`;
}

export function resolveSecureWs(config: AppConfig): boolean {
  if (config.registry.secureWs !== undefined) {
    return config.registry.secureWs;
  }
  return config.registry.protocol === "https";
}
