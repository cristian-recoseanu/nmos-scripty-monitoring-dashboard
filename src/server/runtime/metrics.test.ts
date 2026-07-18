import { afterEach, describe, expect, it } from "vitest";

import {
  buildRuntimeMetrics,
  getCounterSnapshot,
  incrementMetric,
  incrementSubscriptionRetries,
  markRuntimeStarted,
  resetMetrics,
} from "@/server/runtime/metrics";

afterEach(() => {
  resetMetrics();
});

describe("runtime metrics", () => {
  it("tracks counters and builds a snapshot", () => {
    markRuntimeStarted(1_700_000_000_000);
    incrementMetric("grainsApplied", 3);
    incrementMetric("malformedGrains");
    incrementMetric("malformedIs12Messages");
    incrementMetric("ncpReconnects");
    incrementMetric("is04WsReconnects");
    incrementSubscriptionRetries();

    const counters = getCounterSnapshot();
    expect(counters.grainsApplied).toBe(3);
    expect(counters.malformedGrains).toBe(1);
    expect(counters.subscriptionRetries).toBe(1);
    expect(counters.startedAt).toBe(1_700_000_000_000);

    const metrics = buildRuntimeMetrics({
      resources: {
        nodes: 1,
        devices: 2,
        senders: 3,
        receivers: 4,
        flows: 5,
        sources: 6,
      },
      ncp: { sessions: 2, connected: 1, unavailableDevices: 1 },
      is04ConnectedPaths: 6,
    });

    expect(metrics.is04.subscriptionRetries).toBe(1);
    expect(metrics.counters.grainsApplied).toBe(3);
    expect(metrics.ncp.sessions).toBe(2);
  });
});
