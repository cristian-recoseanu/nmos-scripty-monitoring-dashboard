import { EventEmitter } from "node:events";

import type { Is05CacheEntry } from "./types";

/**
 * In-process cache of harvested IS-05 active/transport-file state.
 */
export class Is05Cache extends EventEmitter {
  private readonly entries = new Map<string, Is05CacheEntry>();

  get(resourceId: string): Is05CacheEntry | undefined {
    return this.entries.get(resourceId);
  }

  set(entry: Is05CacheEntry): void {
    this.entries.set(entry.resourceId, entry);
    this.emit("updated", entry);
  }

  delete(resourceId: string): boolean {
    const existed = this.entries.delete(resourceId);
    if (existed) {
      this.emit("removed", resourceId);
    }
    return existed;
  }

  clearDevice(deviceId: string): string[] {
    const removed: string[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.deviceId === deviceId) {
        this.entries.delete(id);
        removed.push(id);
        this.emit("removed", id);
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
    this.emit("cleared");
  }

  list(): Is05CacheEntry[] {
    return [...this.entries.values()];
  }
}
