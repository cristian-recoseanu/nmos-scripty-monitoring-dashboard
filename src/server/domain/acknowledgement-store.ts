import type { EntityKind } from "./health-aggregator";

export type AckableKind = Exclude<EntityKind, "system">;

export function acknowledgementKey(kind: AckableKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * In-memory acknowledgement flags for node / device / sender / receiver.
 * Process-local (matches AppRuntime singleton deployment assumption).
 */
export class AcknowledgementStore {
  private readonly acked = new Set<string>();

  isAcknowledged(kind: AckableKind, id: string): boolean {
    return this.acked.has(acknowledgementKey(kind, id));
  }

  setAcknowledged(kind: AckableKind, id: string, value: boolean): void {
    const key = acknowledgementKey(kind, id);
    if (value) {
      this.acked.add(key);
    } else {
      this.acked.delete(key);
    }
  }

  clear(): void {
    this.acked.clear();
  }
}
