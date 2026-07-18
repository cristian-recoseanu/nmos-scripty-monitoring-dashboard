import pino, { type Logger, type LoggerOptions } from "pino";

import type { LogLevel } from "@/config/schema";

const SENSITIVE_KEY_PATTERN =
  /(authorization|password|passwd|secret|token|api[_-]?key|credential)/i;

export type LoggerBindings = {
  component?: string;
  resourceType?: string;
  resourceId?: string;
  deviceId?: string;
  connectionId?: string;
  subscriptionId?: string;
  [key: string]: unknown;
};

export type CreateLoggerOptions = {
  level?: LogLevel;
  /** Force pretty printing (defaults to non-production). */
  pretty?: boolean;
  bindings?: LoggerBindings;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Redact sensitive fields from log payloads. Mutates a shallow clone tree.
 */
export function redactSensitive(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 8) {
    return "[Truncated]";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitive(entry, depth + 1));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = "[Redacted]";
    } else {
      result[key] = redactSensitive(entry, depth + 1);
    }
  }
  return result;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const pretty =
    options.pretty ??
    (process.env.NODE_ENV !== "production" && process.env.CI !== "true");

  const loggerOptions: LoggerOptions = {
    level,
    base: {
      service: "nmos-scripty-monitoring-dashboard",
      ...options.bindings,
    },
    redact: {
      paths: [
        "authorization",
        "headers.authorization",
        "headers.Authorization",
        "*.authorization",
        "*.password",
        "*.secret",
        "*.token",
      ],
      censor: "[Redacted]",
    },
  };

  if (pretty) {
    loggerOptions.transport = {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    };
  }

  return pino(loggerOptions);
}

export function childLogger(
  parent: Logger,
  bindings: LoggerBindings,
): Logger {
  return parent.child(redactSensitive(bindings) as LoggerBindings);
}

let rootLogger: Logger | undefined;

/**
 * Process-wide root logger. Call {@link configureRootLogger} at startup once
 * config is loaded; until then a default info-level logger is used.
 */
export function getRootLogger(): Logger {
  if (!rootLogger) {
    rootLogger = createLogger();
  }
  return rootLogger;
}

export function configureRootLogger(options: CreateLoggerOptions): Logger {
  rootLogger = createLogger(options);
  return rootLogger;
}

/** Test helper to clear the singleton between suites. */
export function resetRootLogger(): void {
  rootLogger = undefined;
}

export type { Logger };
