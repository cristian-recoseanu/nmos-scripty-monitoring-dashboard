import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import {
  type AppConfig,
  appConfigSchema,
  buildQueryApiBaseUrl,
  resolveSecureWs,
} from "./schema";

export class ConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConfigError";
  }
}

type RawConfig = Record<string, unknown>;

function readOptionalYamlFile(path: string): RawConfig | undefined {
  try {
    const contents = readFileSync(path, "utf8");
    const parsed: unknown = parseYaml(contents);
    if (parsed === null || parsed === undefined) {
      return {};
    }
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ConfigError(`Config file must contain a YAML mapping: ${path}`);
    }
    return parsed as RawConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError(`Failed to read config file: ${path}`, {
      cause: error,
    });
  }
}

function envValue(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return value;
}

function configFromEnv(env: NodeJS.ProcessEnv): RawConfig {
  const registry: RawConfig = {};

  const host = envValue(env, "NMOS_REGISTRY_HOST") ?? envValue(env, "NMOS_REGISTRY_URL");
  if (host !== undefined) {
    // Allow full URL in NMOS_REGISTRY_URL; host-only in NMOS_REGISTRY_HOST.
    if (host.includes("://")) {
      try {
        const url = new URL(host);
        registry.protocol = url.protocol.replace(":", "");
        registry.host = url.hostname;
        if (url.port) {
          registry.port = url.port;
        }
        if (url.pathname && url.pathname !== "/") {
          registry.basePath = url.pathname.replace(/\/$/, "");
        }
      } catch (error) {
        throw new ConfigError(`Invalid NMOS_REGISTRY_URL: ${host}`, {
          cause: error,
        });
      }
    } else {
      registry.host = host;
    }
  }

  const port = envValue(env, "NMOS_REGISTRY_PORT");
  if (port !== undefined) {
    registry.port = port;
  }

  const protocol = envValue(env, "NMOS_REGISTRY_PROTOCOL");
  if (protocol !== undefined) {
    registry.protocol = protocol;
  }

  const queryApiVersion = envValue(env, "NMOS_QUERY_API_VERSION");
  if (queryApiVersion !== undefined) {
    registry.queryApiVersion = queryApiVersion;
  }

  const basePath = envValue(env, "NMOS_QUERY_BASE_PATH");
  if (basePath !== undefined) {
    registry.basePath = basePath;
  }

  const secureWs = envValue(env, "NMOS_REGISTRY_SECURE_WS");
  if (secureWs !== undefined) {
    registry.secureWs = secureWs;
  }

  const result: RawConfig = {};
  if (Object.keys(registry).length > 0) {
    result.registry = registry;
  }

  const logLevel = envValue(env, "LOG_LEVEL");
  if (logLevel !== undefined) {
    result.logLevel = logLevel;
  }

  const appPort = envValue(env, "PORT") ?? envValue(env, "APP_PORT");
  if (appPort !== undefined) {
    result.appPort = appPort;
  }

  return result;
}

function deepMerge(base: RawConfig, override: RawConfig): RawConfig {
  const merged: RawConfig = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof merged[key] === "object" &&
      merged[key] !== null &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = deepMerge(merged[key] as RawConfig, value as RawConfig);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function resolveConfigPath(
  env: NodeJS.ProcessEnv,
  configPath?: string,
): string {
  const configured = configPath ?? env.NMOS_CONFIG_PATH ?? "config.yaml";
  if (configured.startsWith("/")) {
    return configured;
  }
  // Keep resolution under cwd so bundlers do not trace the whole filesystem.
  return join(/*turbopackIgnore: true*/ process.cwd(), configured);
}

export type LoadConfigOptions = {
  /** Absolute or relative path to optional YAML config file. */
  configPath?: string;
  /** Environment bag used for tests; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** When true, skip reading a config file even if configPath is set. */
  ignoreFile?: boolean;
};

/**
 * Load application configuration from an optional YAML file and environment
 * variables. Environment values take precedence over the file.
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const env = options.env ?? process.env;
  const path = resolveConfigPath(env, options.configPath);

  const fromFile = options.ignoreFile ? undefined : readOptionalYamlFile(path);
  const fromEnv = configFromEnv(env);
  const merged = deepMerge(fromFile ?? {}, fromEnv);

  const parsed = appConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`Invalid configuration: ${details}`);
  }

  return parsed.data;
}

export function summariseConfig(config: AppConfig): Record<string, unknown> {
  return {
    registry: {
      host: config.registry.host,
      port: config.registry.port,
      protocol: config.registry.protocol,
      queryApiVersion: config.registry.queryApiVersion,
      basePath: config.registry.basePath,
      secureWs: resolveSecureWs(config),
      queryApiBaseUrl: buildQueryApiBaseUrl(config),
    },
    logLevel: config.logLevel,
    appPort: config.appPort,
  };
}

export {
  appConfigSchema,
  buildQueryApiBaseUrl,
  resolveSecureWs,
  type AppConfig,
};
