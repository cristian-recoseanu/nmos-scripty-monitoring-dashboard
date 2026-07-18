/**
 * Lightweight in-process metrics for observability (no external backend).
 */

export type RuntimeMetrics = {
  resources: {
    nodes: number;
    devices: number;
    senders: number;
    receivers: number;
    flows: number;
    sources: number;
  };
  ncp: {
    sessions: number;
    connected: number;
    unavailableDevices: number;
  };
  is04: {
    connectedPaths: number;
    subscriptionRetries: number;
  };
  counters: {
    grainsApplied: number;
    malformedGrains: number;
    malformedIs12Messages: number;
    ncpReconnects: number;
    is04WsReconnects: number;
  };
  startedAt?: number;
};

type CounterKey = keyof RuntimeMetrics["counters"];

const counters: RuntimeMetrics["counters"] = {
  grainsApplied: 0,
  malformedGrains: 0,
  malformedIs12Messages: 0,
  ncpReconnects: 0,
  is04WsReconnects: 0,
};

let startedAt: number | undefined;
let subscriptionRetries = 0;

export function markRuntimeStarted(at = Date.now()): void {
  startedAt = at;
}

export function incrementMetric(key: CounterKey, by = 1): void {
  counters[key] += by;
}

export function incrementSubscriptionRetries(): void {
  subscriptionRetries += 1;
}

export function getCounterSnapshot(): RuntimeMetrics["counters"] & {
  subscriptionRetries: number;
  startedAt?: number;
} {
  return {
    ...counters,
    subscriptionRetries,
    startedAt,
  };
}

export function resetMetrics(): void {
  counters.grainsApplied = 0;
  counters.malformedGrains = 0;
  counters.malformedIs12Messages = 0;
  counters.ncpReconnects = 0;
  counters.is04WsReconnects = 0;
  subscriptionRetries = 0;
  startedAt = undefined;
}

export function buildRuntimeMetrics(input: {
  resources: RuntimeMetrics["resources"];
  ncp: RuntimeMetrics["ncp"];
  is04ConnectedPaths: number;
}): RuntimeMetrics {
  return {
    resources: input.resources,
    ncp: input.ncp,
    is04: {
      connectedPaths: input.is04ConnectedPaths,
      subscriptionRetries,
    },
    counters: { ...counters },
    startedAt,
  };
}
