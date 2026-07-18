import { afterEach, describe, expect, it } from "vitest";

import {
  childLogger,
  configureRootLogger,
  createLogger,
  getRootLogger,
  redactSensitive,
  resetRootLogger,
} from "@/server/logging";

afterEach(() => {
  resetRootLogger();
});

describe("redactSensitive", () => {
  it("redacts sensitive keys case-insensitively", () => {
    const redacted = redactSensitive({
      authorization: "Bearer secret",
      Authorization: "Bearer secret",
      nested: { apiKey: "abc", label: "ok" },
      list: [{ password: "x" }, "plain"],
    }) as Record<string, unknown>;

    expect(redacted.authorization).toBe("[Redacted]");
    expect(redacted.Authorization).toBe("[Redacted]");
    expect((redacted.nested as Record<string, unknown>).apiKey).toBe(
      "[Redacted]",
    );
    expect((redacted.nested as Record<string, unknown>).label).toBe("ok");
    expect((redacted.list as unknown[])[0]).toEqual({ password: "[Redacted]" });
    expect((redacted.list as unknown[])[1]).toBe("plain");
  });
});

describe("createLogger / childLogger", () => {
  it("creates a logger at the requested level", () => {
    const logger = createLogger({ level: "debug", pretty: false });
    expect(logger.level).toBe("debug");
  });

  it("creates child loggers with bindings", () => {
    const parent = createLogger({ level: "info", pretty: false });
    const child = childLogger(parent, {
      component: "is04",
      resourceType: "device",
      resourceId: "abc",
      authorization: "should-not-leak",
    });

    expect(child.bindings()).toMatchObject({
      component: "is04",
      resourceType: "device",
      resourceId: "abc",
      authorization: "[Redacted]",
    });
  });
});

describe("root logger singleton", () => {
  it("returns a default root logger then allows reconfigure", () => {
    const first = getRootLogger();
    const second = getRootLogger();
    expect(first).toBe(second);

    const configured = configureRootLogger({ level: "warn", pretty: false });
    expect(configured.level).toBe("warn");
    expect(getRootLogger()).toBe(configured);
  });
});
