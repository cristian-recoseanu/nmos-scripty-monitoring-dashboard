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
 */
export class RuntimeEventBus extends EventEmitter {
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private readonly debounceMs: number;
  private buildSnapshot: () => SystemSnapshotDto;

  constructor(
    buildSnapshot: () => SystemSnapshotDto,
    debounceMs = 250,
  ) {
    super();
    this.buildSnapshot = buildSnapshot;
    this.debounceMs = debounceMs;
    this.setMaxListeners(100);
  }

  setSnapshotBuilder(buildSnapshot: () => SystemSnapshotDto): void {
    this.buildSnapshot = buildSnapshot;
  }

  notifyChanged(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      const snapshot = this.buildSnapshot();
      const event: RuntimeEvent = { type: "snapshot", snapshot };
      this.emit("event", event);
    }, this.debounceMs);
  }

  publishSnapshotNow(): SystemSnapshotDto {
    const snapshot = this.buildSnapshot();
    this.emit("event", { type: "snapshot", snapshot } satisfies RuntimeEvent);
    return snapshot;
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }
}

export type { SelectionDetailDto, SystemSnapshotDto };
