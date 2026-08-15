import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

/**
 * Keep in sync with `resolveListenPort` in src/config/load-config.ts:
 * PORT / APP_PORT env → YAML appPort → 3000.
 */
function envValue(env, name) {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return value;
}

function parseListenPort(raw, label) {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid ${label}: ${String(raw)}`);
  }
  return parsed;
}

function resolveListenPort() {
  const env = process.env;
  const fromEnv = envValue(env, "PORT") ?? envValue(env, "APP_PORT");
  if (fromEnv !== undefined) {
    return parseListenPort(fromEnv, "PORT");
  }

  const configured = envValue(env, "NMOS_CONFIG_PATH") ?? "config.yaml";
  const path = configured.startsWith("/")
    ? configured
    : join(process.cwd(), configured);

  try {
    const parsed = parseYaml(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const raw = parsed.appPort;
      if (raw !== undefined && raw !== null && raw !== "") {
        return parseListenPort(raw, "appPort");
      }
    }
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return 3000;
    }
    throw error;
  }

  return 3000;
}

const port = String(resolveListenPort());
process.env.PORT = port;

const nextBin = join(
  process.cwd(),
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const child = spawn(process.execPath, [nextBin, "start", "-p", port], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
