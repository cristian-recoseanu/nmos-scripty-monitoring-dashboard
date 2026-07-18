import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ConfigError,
  appConfigSchema,
  buildQueryApiBaseUrl,
  loadConfig,
  resolveSecureWs,
  summariseConfig,
} from "@/config";

describe("appConfigSchema", () => {
  it("accepts a minimal valid registry config and applies defaults", () => {
    const config = appConfigSchema.parse({
      registry: { host: "127.0.0.1", port: 3211 },
    });

    expect(config.registry.protocol).toBe("http");
    expect(config.registry.queryApiVersion).toBe("v1.3");
    expect(config.registry.basePath).toBe("/x-nmos/query");
    expect(config.logLevel).toBe("info");
    expect(config.appPort).toBe(3000);
  });

  it("rejects missing host", () => {
    const result = appConfigSchema.safeParse({
      registry: { port: 3211 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid query API version", () => {
    const result = appConfigSchema.safeParse({
      registry: { host: "reg", port: 80, queryApiVersion: "1.3" },
    });
    expect(result.success).toBe(false);
  });

  it("coerces boolean secureWs from strings", () => {
    const config = appConfigSchema.parse({
      registry: { host: "reg", port: 443, protocol: "https", secureWs: "true" },
    });
    expect(config.registry.secureWs).toBe(true);
  });

  it("rejects invalid boolean strings for secureWs", () => {
    const result = appConfigSchema.safeParse({
      registry: { host: "reg", port: 80, secureWs: "maybe" },
    });
    expect(result.success).toBe(false);
  });
});

describe("buildQueryApiBaseUrl / resolveSecureWs", () => {
  it("builds the Query API base URL", () => {
    const config = appConfigSchema.parse({
      registry: {
        host: "registry.example",
        port: 443,
        protocol: "https",
        basePath: "/x-nmos/query/",
        queryApiVersion: "v1.3",
      },
    });
    expect(buildQueryApiBaseUrl(config)).toBe(
      "https://registry.example:443/x-nmos/query/v1.3",
    );
  });

  it("derives secureWs from protocol when omitted", () => {
    const httpConfig = appConfigSchema.parse({
      registry: { host: "a", port: 80 },
    });
    const httpsConfig = appConfigSchema.parse({
      registry: { host: "a", port: 443, protocol: "https" },
    });
    expect(resolveSecureWs(httpConfig)).toBe(false);
    expect(resolveSecureWs(httpsConfig)).toBe(true);
  });

  it("honours explicit secureWs", () => {
    const config = appConfigSchema.parse({
      registry: { host: "a", port: 80, secureWs: true },
    });
    expect(resolveSecureWs(config)).toBe(true);
  });
});

describe("loadConfig", () => {
  it("loads from environment variables", () => {
    const config = loadConfig({
      ignoreFile: true,
      env: {
        NMOS_REGISTRY_HOST: "10.0.0.5",
        NMOS_REGISTRY_PORT: "3211",
        LOG_LEVEL: "debug",
        APP_PORT: "4000",
      },
    });

    expect(config.registry.host).toBe("10.0.0.5");
    expect(config.registry.port).toBe(3211);
    expect(config.logLevel).toBe("debug");
    expect(config.appPort).toBe(4000);
  });

  it("parses a full registry URL from NMOS_REGISTRY_URL", () => {
    const config = loadConfig({
      ignoreFile: true,
      env: {
        NMOS_REGISTRY_URL: "https://nmos.lab:8443/custom/query",
        NMOS_REGISTRY_PORT: "8443",
      },
    });

    expect(config.registry.protocol).toBe("https");
    expect(config.registry.host).toBe("nmos.lab");
    expect(config.registry.port).toBe(8443);
    expect(config.registry.basePath).toBe("/custom/query");
  });

  it("lets environment override file values", () => {
    const dir = mkdtempSync(join(tmpdir(), "nmos-config-"));
    const path = join(dir, "config.yaml");
    writeFileSync(
      path,
      [
        "registry:",
        "  host: from-file",
        "  port: 1111",
        "logLevel: warn",
        "",
      ].join("\n"),
    );

    const config = loadConfig({
      configPath: path,
      env: {
        NMOS_REGISTRY_HOST: "from-env",
        NMOS_REGISTRY_PORT: "2222",
      },
    });

    expect(config.registry.host).toBe("from-env");
    expect(config.registry.port).toBe(2222);
    expect(config.logLevel).toBe("warn");
  });

  it("fails fast on invalid configuration", () => {
    expect(() =>
      loadConfig({
        ignoreFile: true,
        env: { NMOS_REGISTRY_HOST: "only-host" },
      }),
    ).toThrow(ConfigError);
  });

  it("fails on invalid YAML config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "nmos-config-"));
    const path = join(dir, "config.yaml");
    writeFileSync(path, "registry: [\n  - broken");

    expect(() =>
      loadConfig({
        configPath: path,
        env: {},
      }),
    ).toThrow(ConfigError);
  });

  it("summarises config without secrets", () => {
    const config = loadConfig({
      ignoreFile: true,
      env: {
        NMOS_REGISTRY_HOST: "127.0.0.1",
        NMOS_REGISTRY_PORT: "3211",
      },
    });
    const summary = summariseConfig(config);
    expect(summary).toMatchObject({
      registry: {
        host: "127.0.0.1",
        port: 3211,
        queryApiBaseUrl: "http://127.0.0.1:3211/x-nmos/query/v1.3",
      },
    });
  });
});
