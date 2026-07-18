import { afterEach, describe, expect, it } from "vitest";

import {
  getAppRuntime,
  resetAppRuntime,
} from "@/server/runtime/app-runtime";

afterEach(() => {
  resetAppRuntime();
});

describe("AppRuntime", () => {
  it("records config errors and still serves an empty snapshot", async () => {
    const previous = { ...process.env };
    delete process.env.NMOS_REGISTRY_HOST;
    delete process.env.NMOS_REGISTRY_PORT;
    delete process.env.NMOS_REGISTRY_URL;
    process.env.NMOS_CONFIG_PATH = "/tmp/nmos-missing-config.json";

    try {
      const runtime = getAppRuntime();
      await runtime.ensureStarted();

      const status = runtime.getStatus();
      expect(status.started).toBe(false);
      expect(status.configError).toMatch(/Invalid configuration|Failed to read/);

      const snapshot = runtime.getSnapshot();
      expect(snapshot.system.health).toBe("unknown");
      expect(snapshot.system.children).toEqual([]);

      const detail = runtime.getDetail("system", "system");
      expect(detail?.kind).toBe("system");
    } finally {
      process.env = previous;
    }
  });

  it("returns the same singleton instance", () => {
    expect(getAppRuntime()).toBe(getAppRuntime());
  });
});
