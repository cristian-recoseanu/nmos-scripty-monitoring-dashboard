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

function domainFrom(
  status?: unknown,
  message?: unknown,
  counter?: unknown,
): DomainStatusSnapshot {
  return {
    status: status as number | string | undefined,
    message: (message as string | null | undefined) ?? null,
    transitionCounter:
      typeof counter === "number" ? counter : undefined,
  };
}

export class MonitorCache extends EventEmitter {
  private readonly byOid = new Map<NcOid, MonitorState>();
  private readonly oidByResourceId = new Map<string, NcOid>();

  get(oid: NcOid): MonitorState | undefined {
    return this.byOid.get(oid);
  }

  getByResourceId(resourceId: string): MonitorState | undefined {
    const oid = this.oidByResourceId.get(resourceId);
    return oid === undefined ? undefined : this.byOid.get(oid);
  }

  listForDevice(deviceId: string): MonitorState[] {
    return [...this.byOid.values()].filter(
      (state) => state.deviceId === deviceId,
    );
  }

  listAll(): MonitorState[] {
    return [...this.byOid.values()];
  }

  clearDevice(deviceId: string): void {
    for (const [oid, state] of this.byOid.entries()) {
      if (state.deviceId === deviceId) {
        if (state.resourceId) {
          this.oidByResourceId.delete(state.resourceId);
        }
        this.byOid.delete(oid);
      }
    }
    this.emit("cleared", { deviceId });
  }

  clear(): void {
    this.byOid.clear();
    this.oidByResourceId.clear();
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
    this.put(state);
    return state;
  }

  applyNotification(notification: Is12Notification): MonitorState | undefined {
    const state = this.byOid.get(notification.oid);
    if (!state || !notification.eventData?.propertyId) {
      return undefined;
    }

    const propertyId = notification.eventData.propertyId;
    const value = notification.eventData.value;
    this.applyProperty(state, propertyId, value);
    state.health = mapOverallStatus(
      overallStatusName(state.overallStatus) ?? state.overallStatus,
    );
    state.lastUpdated = Date.now();
    this.emit("updated", state);
    return state;
  }

  private put(state: MonitorState): void {
    const previous = this.byOid.get(state.oid);
    if (previous?.resourceId && previous.resourceId !== state.resourceId) {
      this.oidByResourceId.delete(previous.resourceId);
    }
    this.byOid.set(state.oid, state);
    if (state.resourceId) {
      this.oidByResourceId.set(state.resourceId, state.oid);
    }
    this.emit("updated", state);
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
