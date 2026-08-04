import { describe, expect, it, vi } from "vitest";

import { RuntimeEventBus } from "@/server/domain/event-bus";
import type { SystemSnapshotDto } from "@/server/domain/snapshot";

function emptySnapshot(generatedAt = Date.now()): SystemSnapshotDto {
  return {
    generatedAt,
    registry: { connected: false },
    system: {
      kind: "system",
      id: "system",
      label: "System",
      health: "healthy",
      childCount: 0,
      totalTransitions: 0,
      children: [],
    },
    connections: { hubs: [], disconnected: [] },
  };
}

describe("RuntimeEventBus", () => {
  it("isolates listener errors so other subscribers still receive events", () => {
    let builds = 0;
    const bus = new RuntimeEventBus(() => {
      builds += 1;
      return emptySnapshot(builds);
    }, 5);

    const good = vi.fn();
    const bad = vi.fn(() => {
      throw new Error("dead SSE client");
    });

    bus.subscribe(bad);
    bus.subscribe(good);

    bus.publishSnapshotNow();

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(good.mock.calls[0]?.[0]).toMatchObject({ type: "snapshot" });
  });

  it("debounces notifyChanged into a single snapshot publish", async () => {
    let builds = 0;
    const bus = new RuntimeEventBus(() => {
      builds += 1;
      return emptySnapshot(builds);
    }, 20);

    const listener = vi.fn();
    bus.subscribe(listener);

    bus.notifyChanged();
    bus.notifyChanged();
    bus.notifyChanged();

    expect(listener).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(1);
    });
    expect(builds).toBe(1);
  });

  it("periodically republishes snapshots when refresh is started", async () => {
    const bus = new RuntimeEventBus(() => emptySnapshot(), 5, 30);
    const listener = vi.fn();
    bus.subscribe(listener);
    bus.startPeriodicRefresh();

    await vi.waitFor(() => {
      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    bus.stopPeriodicRefresh();
  });
});
