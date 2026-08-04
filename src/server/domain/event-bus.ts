import { EventEmitter } from "node:events";

import type {
  SelectionDetailDto,
  SystemSnapshotDto,
} from "@/server/domain/snapshot";

export type RuntimeEvent =
  | { type: "snapshot"; snapshot: SystemSnapshotDto }
  | { type: "heartbeat"; at: number };

/**
 * Fan-out hub for SSE clients. Debounces snapshot broadcasts on change storms.
 *
 * Listener errors are isolated so one dead SSE client cannot stop updates for
 * everyone else (a common long-runtime failure mode).
 */
export class RuntimeEventBus extends EventEmitter {
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private readonly debounceMs: number;
  private readonly refreshIntervalMs: number;
  private buildSnapshot: () => SystemSnapshotDto;

  constructor(
    buildSnapshot: () => SystemSnapshotDto,
    debounceMs = 250,
    refreshIntervalMs = 30_000,
  ) {
    super();
    this.buildSnapshot = buildSnapshot;
    this.debounceMs = debounceMs;
    this.refreshIntervalMs = refreshIntervalMs;
    this.setMaxListeners(100);
  }

  setSnapshotBuilder(buildSnapshot: () => SystemSnapshotDto): void {
    this.buildSnapshot = buildSnapshot;
  }

  /** Periodic full snapshot republish so UIs recover if an SSE tick was missed. */
  startPeriodicRefresh(): void {
    if (this.refreshTimer || this.refreshIntervalMs <= 0) {
      return;
    }
    this.refreshTimer = setInterval(() => {
      this.publishSnapshotNow();
    }, this.refreshIntervalMs);
    // Do not keep the process alive solely for refresh.
    this.refreshTimer.unref?.();
  }

  stopPeriodicRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  notifyChanged(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.publishSnapshotNow();
    }, this.debounceMs);
  }

  publishSnapshotNow(): SystemSnapshotDto {
    const snapshot = this.buildSnapshot();
    this.emitEvent({ type: "snapshot", snapshot });
    return snapshot;
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    const safeListener = (event: RuntimeEvent) => {
      try {
        listener(event);
      } catch {
        // Isolated — never break fan-out for other subscribers.
      }
    };
    this.on("event", safeListener);
    return () => this.off("event", safeListener);
  }

  private emitEvent(event: RuntimeEvent): void {
    // Prefer subscribe()'s safe wrappers; still guard raw .on("event") callers.
    for (const listener of this.listeners("event")) {
      try {
        (listener as (event: RuntimeEvent) => void)(event);
      } catch {
        // ignore
      }
    }
  }
}

export type { SelectionDetailDto, SystemSnapshotDto };
