import { describe, expect, it } from "vitest";

import {
  aggregateParentHealth,
  compareSeverity,
  formatNcStatus,
  mapOverallStatus,
  worstSeverity,
} from "@/lib/health";

describe("mapOverallStatus", () => {
  it("maps known statuses", () => {
    expect(mapOverallStatus("Healthy")).toBe("healthy");
    expect(mapOverallStatus("PartiallyHealthy")).toBe("degraded");
    expect(mapOverallStatus("Unhealthy")).toBe("unhealthy");
    expect(mapOverallStatus("Inactive")).toBe("inactive");
    expect(mapOverallStatus("NotUsed")).toBe("inactive");
  });

  it("maps missing / unknown values to unknown", () => {
    expect(mapOverallStatus(undefined)).toBe("unknown");
    expect(mapOverallStatus(null)).toBe("unknown");
    expect(mapOverallStatus("SomethingElse")).toBe("unknown");
  });

  it("maps numeric NcOverallStatus enums", () => {
    expect(mapOverallStatus(0)).toBe("inactive");
    expect(mapOverallStatus(1)).toBe("healthy");
    expect(mapOverallStatus(2)).toBe("degraded");
    expect(mapOverallStatus(3)).toBe("unhealthy");
    expect(mapOverallStatus(99)).toBe("unknown");
  });
});

describe("worstSeverity", () => {
  it("returns unknown for an empty list", () => {
    expect(worstSeverity([])).toBe("unknown");
  });

  it("picks the worst child", () => {
    expect(worstSeverity(["healthy", "degraded", "inactive"])).toBe("degraded");
    expect(worstSeverity(["unknown", "healthy"])).toBe("unknown");
    expect(worstSeverity(["inactive", "healthy", "unhealthy"])).toBe(
      "unhealthy",
    );
  });
});

describe("aggregateParentHealth", () => {
  it("ignores unknown and inactive when bubbling", () => {
    expect(aggregateParentHealth(["unknown", "healthy"])).toBe("healthy");
    expect(aggregateParentHealth(["inactive", "degraded", "unknown"])).toBe(
      "degraded",
    );
    expect(aggregateParentHealth(["inactive", "unknown"])).toBe("unknown");
    expect(aggregateParentHealth([])).toBe("unknown");
  });
});

describe("compareSeverity", () => {
  it("orders unhealthy before healthy", () => {
    expect(compareSeverity("unhealthy", "healthy")).toBeLessThan(0);
    expect(compareSeverity("inactive", "unknown")).toBeGreaterThan(0);
  });
});

describe("formatNcStatus", () => {
  it("renders enum label with int value", () => {
    expect(formatNcStatus(1)).toBe("Healthy (1)");
    expect(formatNcStatus(2)).toBe("PartiallyHealthy (2)");
    expect(formatNcStatus("Unhealthy")).toBe("Unhealthy (3)");
    expect(formatNcStatus(undefined)).toBe("—");
    expect(formatNcStatus(99)).toBe("99");
  });
});
