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
  appPort: z.coerce.number().int().min(1).max(65535).default(3000),
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
