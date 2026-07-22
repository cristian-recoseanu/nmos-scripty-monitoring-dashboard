import { EventEmitter } from "node:events";

import { mapOverallStatus, type HealthSeverity } from "@/lib/health";
import type { Is12Notification, Is12Session, NcElementId, NcOid } from "@/server/is12";
import { elementIdKey, elementIdsEqual } from "@/server/is12";

import {
  PROP_AUTO_RESET_COUNTERS,
  PROP_CONNECTION_OR_TRANSMISSION_STATUS,
  PROP_CONNECTION_OR_TRANSMISSION_STATUS_MESSAGE,
  PROP_CONNECTION_OR_TRANSMISSION_TRANSITION_COUNTER,
  PROP_EXTERNAL_SYNC_STATUS,
  PROP_EXTERNAL_SYNC_STATUS_MESSAGE,
  PROP_EXTERNAL_SYNC_TRANSITION_COUNTER,
  PROP_LINK_STATUS,
  PROP_LINK_STATUS_MESSAGE,
  PROP_LINK_STATUS_TRANSITION_COUNTER,
  PROP_OVERALL_STATUS,
  PROP_OVERALL_STATUS_MESSAGE,
  PROP_STATUS_REPORTING_DELAY,
  PROP_STREAM_OR_ESSENCE_STATUS,
  PROP_STREAM_OR_ESSENCE_STATUS_MESSAGE,
  PROP_STREAM_OR_ESSENCE_TRANSITION_COUNTER,
  PROP_SYNC_SOURCE_ID,
  overallStatusName,
  type MonitorKind,
} from "./class-ids";
import type { DiscoveredMonitor } from "./model-harvest";
import type { MonitorTouchpointLink } from "./touchpoints";

export type DomainStatusSnapshot = {
  status?: number | string;
  message?: string | null;
  transitionCounter?: number;
};

export type MonitorState = {
  deviceId: string;
  kind: MonitorKind;
  oid: NcOid;
  role: string;
  classId: number[];
  userLabel?: string | null;
  resourceId?: string;
  overallStatus?: number | string;
  overallStatusMessage?: string | null;
  statusReportingDelay?: number;
  autoResetCountersAndMessages?: boolean;
  link?: DomainStatusSnapshot;
  /** connectionStatus (receiver) or transmissionStatus (sender) */
  connectivity?: DomainStatusSnapshot;
  externalSync?: DomainStatusSnapshot;
  /** streamStatus (receiver) or essenceStatus (sender) */
  streamOrEssence?: DomainStatusSnapshot;
  synchronizationSourceId?: string | null;
  health: HealthSeverity;
  lastUpdated: number;
};

const PROPERTY_GET_LIST: NcElementId[] = [
  PROP_OVERALL_STATUS,
  PROP_OVERALL_STATUS_MESSAGE,
  PROP_STATUS_REPORTING_DELAY,
  PROP_LINK_STATUS,
  PROP_LINK_STATUS_MESSAGE,
  PROP_LINK_STATUS_TRANSITION_COUNTER,
  PROP_CONNECTION_OR_TRANSMISSION_STATUS,
  PROP_CONNECTION_OR_TRANSMISSION_STATUS_MESSAGE,
  PROP_CONNECTION_OR_TRANSMISSION_TRANSITION_COUNTER,
  PROP_EXTERNAL_SYNC_STATUS,
  PROP_EXTERNAL_SYNC_STATUS_MESSAGE,
  PROP_EXTERNAL_SYNC_TRANSITION_COUNTER,
  PROP_SYNC_SOURCE_ID,
  PROP_STREAM_OR_ESSENCE_STATUS,
  PROP_STREAM_OR_ESSENCE_STATUS_MESSAGE,
  PROP_STREAM_OR_ESSENCE_TRANSITION_COUNTER,
  PROP_AUTO_RESET_COUNTERS,
];

function monitorKey(deviceId: string, oid: NcOid): string {
  return `${deviceId}:${oid}`;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function domainFrom(
  status?: unknown,
  message?: unknown,
  counter?: unknown,
): DomainStatusSnapshot {
  return {
    status: status as number | string | undefined,
    message: (message as string | null | undefined) ?? null,
    transitionCounter: typeof counter === "number" ? counter : undefined,
  };
}

/**
 * Cache of BCP-008 monitor state.
 *
 * Keys are `${deviceId}:${oid}` because MS-05 OIDs are device-local; a global
 * oid map would let one device overwrite another's monitors.
 */
export class MonitorCache extends EventEmitter {
  private readonly byKey = new Map<string, MonitorState>();
  private readonly keyByResourceId = new Map<string, string>();

  get(deviceId: string, oid: NcOid): MonitorState | undefined {
    return this.byKey.get(monitorKey(deviceId, oid));
  }

  getByResourceId(resourceId: string): MonitorState | undefined {
    const key = this.keyByResourceId.get(resourceId);
    return key === undefined ? undefined : this.byKey.get(key);
  }

  listForDevice(deviceId: string): MonitorState[] {
    return [...this.byKey.values()].filter((state) => state.deviceId === deviceId);
  }

  listAll(): MonitorState[] {
    return [...this.byKey.values()];
  }

  clearDevice(deviceId: string): void {
    for (const [key, state] of this.byKey.entries()) {
      if (state.deviceId === deviceId) {
        if (state.resourceId) {
          this.keyByResourceId.delete(state.resourceId);
        }
        this.byKey.delete(key);
      }
    }
    this.emit("cleared", { deviceId });
  }

  /**
   * Atomically replace all monitors for a device (avoids a long empty window
   * and never touches other devices' entries).
   */
  replaceDevice(deviceId: string, states: MonitorState[]): void {
    for (const [key, state] of this.byKey.entries()) {
      if (state.deviceId === deviceId) {
        if (state.resourceId) {
          this.keyByResourceId.delete(state.resourceId);
        }
        this.byKey.delete(key);
      }
    }
    for (const state of states) {
      this.put(state, { emit: true });
    }
    this.emit("replaced", { deviceId, count: states.length });
  }

  clear(): void {
    this.byKey.clear();
    this.keyByResourceId.clear();
  }

  async loadMonitor(
    session: Is12Session,
    deviceId: string,
    monitor: DiscoveredMonitor,
    link: MonitorTouchpointLink,
  ): Promise<MonitorState> {
    const values = new Map<string, unknown>();
    for (const propertyId of PROPERTY_GET_LIST) {
      try {
        const value = await session.getProperty(monitor.oid, propertyId);
        values.set(elementIdKey(propertyId), value);
      } catch {
        // Property may be missing on vendor variants; leave undefined.
      }
    }

    const state = this.buildState(deviceId, monitor, link, values);
    this.put(state, { emit: true });
    return state;
  }

  /**
   * Load monitor properties without mutating the cache (for atomic harvest swap).
   */
  async readMonitorState(
    session: Is12Session,
    deviceId: string,
    monitor: DiscoveredMonitor,
    link: MonitorTouchpointLink,
  ): Promise<MonitorState> {
    const values = new Map<string, unknown>();
    for (const propertyId of PROPERTY_GET_LIST) {
      try {
        const value = await session.getProperty(monitor.oid, propertyId);
        values.set(elementIdKey(propertyId), value);
      } catch {
        // Property may be missing on vendor variants; leave undefined.
      }
    }
    return this.buildState(deviceId, monitor, link, values);
  }

  /**
   * Apply a property notification for a specific device.
   * Returns undefined when the monitor is unknown or the value is unchanged.
   */
  applyNotification(
    notification: Is12Notification,
    deviceId: string,
  ): MonitorState | undefined {
    const state = this.byKey.get(monitorKey(deviceId, notification.oid));
    if (!state || !notification.eventData?.propertyId) {
      return undefined;
    }

    const propertyId = notification.eventData.propertyId;
    const value = notification.eventData.value;
    const before = snapshotProperty(state, propertyId);
    this.applyProperty(state, propertyId, value);
    const after = snapshotProperty(state, propertyId);
    if (valuesEqual(before, after)) {
      return undefined;
    }

    state.health = mapOverallStatus(
      overallStatusName(state.overallStatus) ?? state.overallStatus,
    );
    state.lastUpdated = Date.now();
    this.emit("updated", state);
    return state;
  }

  private put(state: MonitorState, options: { emit: boolean }): void {
    const key = monitorKey(state.deviceId, state.oid);
    const previous = this.byKey.get(key);
    if (previous?.resourceId && previous.resourceId !== state.resourceId) {
      this.keyByResourceId.delete(previous.resourceId);
    }
    this.byKey.set(key, state);
    if (state.resourceId) {
      // Drop any stale mapping from another device that claimed this resource.
      const existingKey = this.keyByResourceId.get(state.resourceId);
      if (existingKey && existingKey !== key) {
        const other = this.byKey.get(existingKey);
        if (other) {
          other.resourceId = undefined;
        }
      }
      this.keyByResourceId.set(state.resourceId, key);
    }
    if (options.emit) {
      this.emit("updated", state);
    }
  }

  private buildState(
    deviceId: string,
    monitor: DiscoveredMonitor,
    link: MonitorTouchpointLink,
    values: Map<string, unknown>,
  ): MonitorState {
    const overallStatus = values.get(elementIdKey(PROP_OVERALL_STATUS)) as
      | number
      | string
      | undefined;

    return {
      deviceId,
      kind: monitor.kind,
      oid: monitor.oid,
      role: monitor.role,
      classId: monitor.classId,
      userLabel: monitor.userLabel,
      resourceId: link.resourceId,
      overallStatus,
      overallStatusMessage: values.get(
        elementIdKey(PROP_OVERALL_STATUS_MESSAGE),
      ) as string | null | undefined,
      statusReportingDelay: values.get(
        elementIdKey(PROP_STATUS_REPORTING_DELAY),
      ) as number | undefined,
      autoResetCountersAndMessages: values.get(
        elementIdKey(PROP_AUTO_RESET_COUNTERS),
      ) as boolean | undefined,
      link: domainFrom(
        values.get(elementIdKey(PROP_LINK_STATUS)),
        values.get(elementIdKey(PROP_LINK_STATUS_MESSAGE)),
        values.get(elementIdKey(PROP_LINK_STATUS_TRANSITION_COUNTER)),
      ),
      connectivity: domainFrom(
        values.get(elementIdKey(PROP_CONNECTION_OR_TRANSMISSION_STATUS)),
        values.get(
          elementIdKey(PROP_CONNECTION_OR_TRANSMISSION_STATUS_MESSAGE),
        ),
        values.get(
          elementIdKey(PROP_CONNECTION_OR_TRANSMISSION_TRANSITION_COUNTER),
        ),
      ),
      externalSync: domainFrom(
        values.get(elementIdKey(PROP_EXTERNAL_SYNC_STATUS)),
        values.get(elementIdKey(PROP_EXTERNAL_SYNC_STATUS_MESSAGE)),
        values.get(elementIdKey(PROP_EXTERNAL_SYNC_TRANSITION_COUNTER)),
      ),
      streamOrEssence: domainFrom(
        values.get(elementIdKey(PROP_STREAM_OR_ESSENCE_STATUS)),
        values.get(elementIdKey(PROP_STREAM_OR_ESSENCE_STATUS_MESSAGE)),
        values.get(elementIdKey(PROP_STREAM_OR_ESSENCE_TRANSITION_COUNTER)),
      ),
      synchronizationSourceId: values.get(elementIdKey(PROP_SYNC_SOURCE_ID)) as
        | string
        | null
        | undefined,
      health: mapOverallStatus(overallStatusName(overallStatus) ?? overallStatus),
      lastUpdated: Date.now(),
    };
  }

  private applyProperty(
    state: MonitorState,
    propertyId: NcElementId,
    value: unknown,
  ): void {
    if (elementIdsEqual(propertyId, PROP_OVERALL_STATUS)) {
      state.overallStatus = value as number | string;
    } else if (elementIdsEqual(propertyId, PROP_OVERALL_STATUS_MESSAGE)) {
      state.overallStatusMessage = value as string | null;
    } else if (elementIdsEqual(propertyId, PROP_STATUS_REPORTING_DELAY)) {
      state.statusReportingDelay = value as number;
    } else if (elementIdsEqual(propertyId, PROP_AUTO_RESET_COUNTERS)) {
      state.autoResetCountersAndMessages = value as boolean;
    } else if (elementIdsEqual(propertyId, PROP_LINK_STATUS)) {
      state.link = { ...state.link, status: value as number | string };
    } else if (elementIdsEqual(propertyId, PROP_LINK_STATUS_MESSAGE)) {
      state.link = { ...state.link, message: value as string | null };
    } else if (
      elementIdsEqual(propertyId, PROP_LINK_STATUS_TRANSITION_COUNTER)
    ) {
      state.link = {
        ...state.link,
        transitionCounter: value as number,
      };
    } else if (
      elementIdsEqual(propertyId, PROP_CONNECTION_OR_TRANSMISSION_STATUS)
    ) {
      state.connectivity = {
        ...state.connectivity,
        status: value as number | string,
      };
    } else if (
      elementIdsEqual(
        propertyId,
        PROP_CONNECTION_OR_TRANSMISSION_STATUS_MESSAGE,
      )
    ) {
      state.connectivity = {
        ...state.connectivity,
        message: value as string | null,
      };
    } else if (
      elementIdsEqual(
        propertyId,
        PROP_CONNECTION_OR_TRANSMISSION_TRANSITION_COUNTER,
      )
    ) {
      state.connectivity = {
        ...state.connectivity,
        transitionCounter: value as number,
      };
    } else if (elementIdsEqual(propertyId, PROP_EXTERNAL_SYNC_STATUS)) {
      state.externalSync = {
        ...state.externalSync,
        status: value as number | string,
      };
    } else if (elementIdsEqual(propertyId, PROP_EXTERNAL_SYNC_STATUS_MESSAGE)) {
      state.externalSync = {
        ...state.externalSync,
        message: value as string | null,
      };
    } else if (
      elementIdsEqual(propertyId, PROP_EXTERNAL_SYNC_TRANSITION_COUNTER)
    ) {
      state.externalSync = {
        ...state.externalSync,
        transitionCounter: value as number,
      };
    } else if (elementIdsEqual(propertyId, PROP_SYNC_SOURCE_ID)) {
      state.synchronizationSourceId = value as string | null;
    } else if (elementIdsEqual(propertyId, PROP_STREAM_OR_ESSENCE_STATUS)) {
      state.streamOrEssence = {
        ...state.streamOrEssence,
        status: value as number | string,
      };
    } else if (
      elementIdsEqual(propertyId, PROP_STREAM_OR_ESSENCE_STATUS_MESSAGE)
    ) {
      state.streamOrEssence = {
        ...state.streamOrEssence,
        message: value as string | null,
      };
    } else if (
      elementIdsEqual(propertyId, PROP_STREAM_OR_ESSENCE_TRANSITION_COUNTER)
    ) {
      state.streamOrEssence = {
        ...state.streamOrEssence,
        transitionCounter: value as number,
      };
    }
  }
}

function snapshotProperty(
  state: MonitorState,
  propertyId: NcElementId,
): unknown {
  if (elementIdsEqual(propertyId, PROP_OVERALL_STATUS)) {
    return state.overallStatus;
  }
  if (elementIdsEqual(propertyId, PROP_OVERALL_STATUS_MESSAGE)) {
    return state.overallStatusMessage;
  }
  if (elementIdsEqual(propertyId, PROP_STATUS_REPORTING_DELAY)) {
    return state.statusReportingDelay;
  }
  if (elementIdsEqual(propertyId, PROP_AUTO_RESET_COUNTERS)) {
    return state.autoResetCountersAndMessages;
  }
  if (elementIdsEqual(propertyId, PROP_LINK_STATUS)) {
    return state.link?.status;
  }
  if (elementIdsEqual(propertyId, PROP_LINK_STATUS_MESSAGE)) {
    return state.link?.message;
  }
  if (elementIdsEqual(propertyId, PROP_LINK_STATUS_TRANSITION_COUNTER)) {
    return state.link?.transitionCounter;
  }
  if (elementIdsEqual(propertyId, PROP_CONNECTION_OR_TRANSMISSION_STATUS)) {
    return state.connectivity?.status;
  }
  if (
    elementIdsEqual(propertyId, PROP_CONNECTION_OR_TRANSMISSION_STATUS_MESSAGE)
  ) {
    return state.connectivity?.message;
  }
  if (
    elementIdsEqual(
      propertyId,
      PROP_CONNECTION_OR_TRANSMISSION_TRANSITION_COUNTER,
    )
  ) {
    return state.connectivity?.transitionCounter;
  }
  if (elementIdsEqual(propertyId, PROP_EXTERNAL_SYNC_STATUS)) {
    return state.externalSync?.status;
  }
  if (elementIdsEqual(propertyId, PROP_EXTERNAL_SYNC_STATUS_MESSAGE)) {
    return state.externalSync?.message;
  }
  if (elementIdsEqual(propertyId, PROP_EXTERNAL_SYNC_TRANSITION_COUNTER)) {
    return state.externalSync?.transitionCounter;
  }
  if (elementIdsEqual(propertyId, PROP_SYNC_SOURCE_ID)) {
    return state.synchronizationSourceId;
  }
  if (elementIdsEqual(propertyId, PROP_STREAM_OR_ESSENCE_STATUS)) {
    return state.streamOrEssence?.status;
  }
  if (elementIdsEqual(propertyId, PROP_STREAM_OR_ESSENCE_STATUS_MESSAGE)) {
    return state.streamOrEssence?.message;
  }
  if (elementIdsEqual(propertyId, PROP_STREAM_OR_ESSENCE_TRANSITION_COUNTER)) {
    return state.streamOrEssence?.transitionCounter;
  }
  return undefined;
}

export type NcCounter = {
  name?: string;
  identification?: number;
  value?: number;
  description?: string;
};

export async function readMonitorProperties(
  session: Is12Session,
  oid: NcOid,
  propertyIds: NcElementId[],
): Promise<Map<string, unknown>> {
  const values = new Map<string, unknown>();
  for (const propertyId of propertyIds) {
    values.set(elementIdKey(propertyId), await session.getProperty(oid, propertyId));
  }
  return values;
}
