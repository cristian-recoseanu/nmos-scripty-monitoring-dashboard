import type { NcClassId, NcElementId } from "@/server/is12";

/** Monitoring feature-set class IDs (AMWA nmos-control-feature-sets). */
export const CLASS_ID_STATUS_MONITOR: NcClassId = [1, 2, 2];
export const CLASS_ID_RECEIVER_MONITOR: NcClassId = [1, 2, 2, 1];
export const CLASS_ID_SENDER_MONITOR: NcClassId = [1, 2, 2, 2];

export type MonitorKind = "receiver" | "sender";

/**
 * True if `classId` is exactly `prefix` or a derived class
 * (prefix is a leading segment of classId).
 */
export function classIdMatches(
  classId: NcClassId | undefined,
  prefix: NcClassId,
): boolean {
  if (!classId || classId.length < prefix.length) {
    return false;
  }
  return prefix.every((part, index) => classId[index] === part);
}

export function detectMonitorKind(
  classId: NcClassId | undefined,
): MonitorKind | undefined {
  if (classIdMatches(classId, CLASS_ID_RECEIVER_MONITOR)) {
    return "receiver";
  }
  if (classIdMatches(classId, CLASS_ID_SENDER_MONITOR)) {
    return "sender";
  }
  // Generic status monitor without sender/receiver specialisation — ignore for BCP-008 UI.
  return undefined;
}

/** NcStatusMonitor properties */
export const PROP_OVERALL_STATUS: NcElementId = { level: 3, index: 1 };
export const PROP_OVERALL_STATUS_MESSAGE: NcElementId = { level: 3, index: 2 };
export const PROP_STATUS_REPORTING_DELAY: NcElementId = { level: 3, index: 3 };

/** Shared level-4 domain properties (same indices for sender/receiver where applicable) */
export const PROP_LINK_STATUS: NcElementId = { level: 4, index: 1 };
export const PROP_LINK_STATUS_MESSAGE: NcElementId = { level: 4, index: 2 };
export const PROP_LINK_STATUS_TRANSITION_COUNTER: NcElementId = {
  level: 4,
  index: 3,
};
export const PROP_CONNECTION_OR_TRANSMISSION_STATUS: NcElementId = {
  level: 4,
  index: 4,
};
export const PROP_CONNECTION_OR_TRANSMISSION_STATUS_MESSAGE: NcElementId = {
  level: 4,
  index: 5,
};
export const PROP_CONNECTION_OR_TRANSMISSION_TRANSITION_COUNTER: NcElementId = {
  level: 4,
  index: 6,
};
export const PROP_EXTERNAL_SYNC_STATUS: NcElementId = { level: 4, index: 7 };
export const PROP_EXTERNAL_SYNC_STATUS_MESSAGE: NcElementId = {
  level: 4,
  index: 8,
};
export const PROP_EXTERNAL_SYNC_TRANSITION_COUNTER: NcElementId = {
  level: 4,
  index: 9,
};
export const PROP_SYNC_SOURCE_ID: NcElementId = { level: 4, index: 10 };
export const PROP_STREAM_OR_ESSENCE_STATUS: NcElementId = {
  level: 4,
  index: 11,
};
export const PROP_STREAM_OR_ESSENCE_STATUS_MESSAGE: NcElementId = {
  level: 4,
  index: 12,
};
export const PROP_STREAM_OR_ESSENCE_TRANSITION_COUNTER: NcElementId = {
  level: 4,
  index: 13,
};
export const PROP_AUTO_RESET_COUNTERS: NcElementId = { level: 4, index: 14 };

/** Receiver methods */
export const METHOD_GET_LOST_PACKET_COUNTERS: NcElementId = {
  level: 4,
  index: 1,
};
export const METHOD_GET_LATE_PACKET_COUNTERS: NcElementId = {
  level: 4,
  index: 2,
};
export const METHOD_RECEIVER_RESET_COUNTERS: NcElementId = {
  level: 4,
  index: 3,
};

/** Sender methods */
export const METHOD_GET_TRANSMISSION_ERROR_COUNTERS: NcElementId = {
  level: 4,
  index: 1,
};
export const METHOD_SENDER_RESET_COUNTERS: NcElementId = {
  level: 4,
  index: 2,
};

export const NcOverallStatus = {
  Inactive: 0,
  Healthy: 1,
  PartiallyHealthy: 2,
  Unhealthy: 3,
} as const;

export type NcOverallStatusValue =
  (typeof NcOverallStatus)[keyof typeof NcOverallStatus];

export function overallStatusName(
  value: number | string | null | undefined,
): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  switch (value) {
    case NcOverallStatus.Inactive:
      return "Inactive";
    case NcOverallStatus.Healthy:
      return "Healthy";
    case NcOverallStatus.PartiallyHealthy:
      return "PartiallyHealthy";
    case NcOverallStatus.Unhealthy:
      return "Unhealthy";
    default:
      return undefined;
  }
}
