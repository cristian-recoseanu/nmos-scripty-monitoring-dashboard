import type { Is12Session, NcOid } from "@/server/is12";

import {
  METHOD_GET_LATE_PACKET_COUNTERS,
  METHOD_GET_LOST_PACKET_COUNTERS,
  METHOD_GET_TRANSMISSION_ERROR_COUNTERS,
  METHOD_RECEIVER_RESET_COUNTERS,
  METHOD_SENDER_RESET_COUNTERS,
  PROP_AUTO_RESET_COUNTERS,
  type MonitorKind,
} from "./class-ids";
import type { NcCounter } from "./monitor-cache";

export type CounterFetchResult = {
  counters: NcCounter[];
  fetchedAt: number;
};

const lastFetchAt = new Map<string, number>();

function throttleKey(deviceId: string, oid: NcOid, method: string): string {
  return `${deviceId}:${oid}:${method}`;
}

/**
 * Ensure counter methods are not polled in a tight loop (BCP-008 guidance).
 */
export function assertCounterThrottle(
  deviceId: string,
  oid: NcOid,
  method: string,
  minIntervalMs = 1000,
): void {
  const key = throttleKey(deviceId, oid, method);
  const previous = lastFetchAt.get(key) ?? 0;
  const now = Date.now();
  if (now - previous < minIntervalMs) {
    throw new Error(
      `Counter fetch throttled for ${method} on oid ${oid} (min ${minIntervalMs}ms)`,
    );
  }
  lastFetchAt.set(key, now);
}

/** Test helper */
export function resetCounterThrottle(): void {
  lastFetchAt.clear();
}

function asCounters(value: unknown): NcCounter[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as NcCounter[];
}

export async function getLostPacketCounters(
  session: Is12Session,
  deviceId: string,
  oid: NcOid,
): Promise<CounterFetchResult> {
  assertCounterThrottle(deviceId, oid, "GetLostPacketCounters");
  const result = await session.invoke(oid, METHOD_GET_LOST_PACKET_COUNTERS);
  return { counters: asCounters(result.value), fetchedAt: Date.now() };
}

export async function getLatePacketCounters(
  session: Is12Session,
  deviceId: string,
  oid: NcOid,
): Promise<CounterFetchResult> {
  assertCounterThrottle(deviceId, oid, "GetLatePacketCounters");
  const result = await session.invoke(oid, METHOD_GET_LATE_PACKET_COUNTERS);
  return { counters: asCounters(result.value), fetchedAt: Date.now() };
}

export async function getTransmissionErrorCounters(
  session: Is12Session,
  deviceId: string,
  oid: NcOid,
): Promise<CounterFetchResult> {
  assertCounterThrottle(deviceId, oid, "GetTransmissionErrorCounters");
  const result = await session.invoke(
    oid,
    METHOD_GET_TRANSMISSION_ERROR_COUNTERS,
  );
  return { counters: asCounters(result.value), fetchedAt: Date.now() };
}

export async function resetCountersAndMessages(
  session: Is12Session,
  kind: MonitorKind,
  oid: NcOid,
): Promise<void> {
  const methodId =
    kind === "receiver"
      ? METHOD_RECEIVER_RESET_COUNTERS
      : METHOD_SENDER_RESET_COUNTERS;
  await session.invoke(oid, methodId);
}

export async function setAutoResetCountersAndMessages(
  session: Is12Session,
  oid: NcOid,
  value: boolean,
): Promise<void> {
  await session.setProperty(oid, PROP_AUTO_RESET_COUNTERS, value);
}
