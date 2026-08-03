import { EventEmitter } from "node:events";

import type { Logger } from "@/server/logging";
import { childLogger } from "@/server/logging";
import {
  Is12Session,
  type WebSocketFactory,
} from "@/server/is12";
import type {
  NmosDevice,
  NmosReceiver,
  NmosSender,
  ResourceStore,
  ResourceStoreEvent,
  Uuid,
} from "@/server/is04";
import { mapOverallStatus } from "@/lib/health";
import { incrementMetric } from "@/server/runtime/metrics";

import { overallStatusName } from "./class-ids";
import { harvestMonitors } from "./model-harvest";
import { MonitorCache, type MonitorState } from "./monitor-cache";
import {
  getLatePacketCounters,
  getLostPacketCounters,
  getTransmissionErrorCounters,
  resetCountersAndMessages,
  setAutoResetCountersAndMessages,
  type CounterFetchResult,
} from "./monitor-control";
import {
  discoverNcpEndpoint,
  type NcpAvailability,
} from "./ncp-discovery";
import { resolveMonitorTouchpoint } from "./touchpoints";

export type DeviceNcpStatus = {
  deviceId: Uuid;
  availability: NcpAvailability;
  href?: string;
  connected: boolean;
  lastError?: string;
};

type DeviceSession = {
  deviceId: Uuid;
  href: string;
  session: Is12Session;
  status: DeviceNcpStatus;
};

type HarvestScheduleState = {
  attempts: number;
  timer?: ReturnType<typeof setTimeout>;
  inFlight: boolean;
  pending: boolean;
};

export type NcpOrchestratorOptions = {
  store: ResourceStore;
  logger: Logger;
  webSocketFactory?: WebSocketFactory;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  /** Debounce before a triggered re-harvest (default 300ms). */
  harvestDebounceMs?: number;
  /** First retry delay after an incomplete harvest (default 1000ms). */
  harvestRetryBaseMs?: number;
  /** Cap for exponential retry delay (default 30000ms). */
  harvestRetryMaxMs?: number;
  /** Max harvest attempts while bindings remain incomplete (default 6). */
  harvestRetryMaxAttempts?: number;
};

/**
 * Watches the resource store for devices, opens one IS-12 session per NCP
 * endpoint, harvests monitors, binds touchpoints, and caches status updates.
 *
 * Re-harvests when senders/receivers are added or version-bumped, and when a
 * device version changes without an NCP href change — with debounce and
 * capped exponential backoff for late-created monitors.
 */
export class NcpOrchestrator extends EventEmitter {
  private readonly store: ResourceStore;
  private readonly logger: Logger;
  private readonly webSocketFactory?: WebSocketFactory;
  private readonly reconnectBaseMs?: number;
  private readonly reconnectMaxMs?: number;
  private readonly harvestDebounceMs: number;
  private readonly harvestRetryBaseMs: number;
  private readonly harvestRetryMaxMs: number;
  private readonly harvestRetryMaxAttempts: number;
  private readonly sessions = new Map<Uuid, DeviceSession>();
  private readonly deviceStatus = new Map<Uuid, DeviceNcpStatus>();
  private readonly harvestGeneration = new Map<Uuid, number>();
  private readonly harvestSchedule = new Map<Uuid, HarvestScheduleState>();
  readonly cache = new MonitorCache();
  private started = false;

  constructor(options: NcpOrchestratorOptions) {
    super();
    this.store = options.store;
    this.logger = childLogger(options.logger, { component: "ncp-orchestrator" });
    this.webSocketFactory = options.webSocketFactory;
    this.reconnectBaseMs = options.reconnectBaseMs;
    this.reconnectMaxMs = options.reconnectMaxMs;
    this.harvestDebounceMs = options.harvestDebounceMs ?? 300;
    this.harvestRetryBaseMs = options.harvestRetryBaseMs ?? 1_000;
    this.harvestRetryMaxMs = options.harvestRetryMaxMs ?? 30_000;
    this.harvestRetryMaxAttempts = options.harvestRetryMaxAttempts ?? 6;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    for (const device of this.store.listDevices()) {
      void this.syncDevice(device);
    }

    this.store.on("change", this.onStoreChange);
    this.cache.on("updated", this.onMonitorUpdated);
  }

  async stop(): Promise<void> {
    this.started = false;
    this.store.off("change", this.onStoreChange);
    this.cache.off("updated", this.onMonitorUpdated);

    for (const deviceId of [...this.harvestSchedule.keys()]) {
      this.clearHarvestSchedule(deviceId);
    }

    const stops = [...this.sessions.values()].map((entry) =>
      entry.session.stop(),
    );
    await Promise.all(stops);
    this.sessions.clear();
    this.cache.clear();
    this.deviceStatus.clear();
  }

  getDeviceStatus(deviceId: Uuid): DeviceNcpStatus | undefined {
    return this.deviceStatus.get(deviceId);
  }

  getOpenSessionCount(): number {
    return this.sessions.size;
  }

  listDeviceStatuses(): DeviceNcpStatus[] {
    return [...this.deviceStatus.values()];
  }

  async getLostPackets(
    deviceId: Uuid,
    oid: number,
  ): Promise<CounterFetchResult> {
    return getLostPacketCounters(this.requireSession(deviceId), deviceId, oid);
  }

  async getLatePackets(
    deviceId: Uuid,
    oid: number,
  ): Promise<CounterFetchResult> {
    return getLatePacketCounters(this.requireSession(deviceId), deviceId, oid);
  }

  async getTransmissionErrors(
    deviceId: Uuid,
    oid: number,
  ): Promise<CounterFetchResult> {
    return getTransmissionErrorCounters(
      this.requireSession(deviceId),
      deviceId,
      oid,
    );
  }

  async resetMonitor(deviceId: Uuid, oid: number): Promise<void> {
    const state = this.cache.get(deviceId, oid);
    if (!state || state.deviceId !== deviceId) {
      throw new Error(`Unknown monitor oid ${oid} for device ${deviceId}`);
    }
    await resetCountersAndMessages(
      this.requireSession(deviceId),
      state.kind,
      oid,
    );
  }

  /**
   * Invoke ResetCountersAndMessages on every cached monitor whose device has
   * an open NCP session.
   */
  async resetAllMonitors(): Promise<{
    reset: number;
    skipped: number;
    failures: Array<{ deviceId: Uuid; oid: number; error: string }>;
  }> {
    const failures: Array<{ deviceId: Uuid; oid: number; error: string }> = [];
    let reset = 0;
    let skipped = 0;

    for (const state of this.cache.listAll()) {
      const session = this.sessions.get(state.deviceId);
      if (!session?.session.isOpen) {
        skipped += 1;
        continue;
      }
      try {
        await resetCountersAndMessages(
          session.session,
          state.kind,
          state.oid,
        );
        reset += 1;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Reset failed";
        failures.push({
          deviceId: state.deviceId,
          oid: state.oid,
          error: message,
        });
        this.logger.warn(
          {
            err: error,
            deviceId: state.deviceId,
            oid: state.oid,
            kind: state.kind,
            resourceId: state.resourceId,
          },
          "Failed to reset monitor during system-wide reset",
        );
      }
    }

    return { reset, skipped, failures };
  }

  async setAutoReset(
    deviceId: Uuid,
    oid: number,
    value: boolean,
  ): Promise<void> {
    await setAutoResetCountersAndMessages(
      this.requireSession(deviceId),
      oid,
      value,
    );
    const state = this.cache.get(deviceId, oid);
    if (state) {
      state.autoResetCountersAndMessages = value;
      state.lastUpdated = Date.now();
      this.cache.emit("updated", state);
    }
  }

  private requireSession(deviceId: Uuid): Is12Session {
    const entry = this.sessions.get(deviceId);
    if (!entry?.session.isOpen) {
      throw new Error(`No open IS-12 session for device ${deviceId}`);
    }
    return entry.session;
  }

  private onStoreChange = (event: ResourceStoreEvent): void => {
    if (event.resourceType === "sender" || event.resourceType === "receiver") {
      this.onSenderReceiverChange(event);
      return;
    }

    if (event.resourceType !== "device") {
      return;
    }

    if (event.type === "resource.removed") {
      void this.teardownDevice(event.id).catch((error) => {
        this.logger.error(
          { err: error, deviceId: event.id },
          "Failed to tear down NCP session for removed device",
        );
      });
      return;
    }

    const previous =
      event.type === "resource.updated"
        ? ((event as Extract<ResourceStoreEvent, { type: "resource.updated" }>)
            .previous as NmosDevice)
        : undefined;

    void this.syncDevice(event.resource as NmosDevice, previous).catch(
      (error) => {
        this.logger.error(
          { err: error, deviceId: event.id },
          "Failed to sync NCP session for device (isolated)",
        );
        this.deviceStatus.set(event.id, {
          deviceId: event.id,
          availability: "unavailable",
          connected: false,
          lastError:
            error instanceof Error ? error.message : "NCP sync failed",
        });
        this.emit("deviceStatus", this.deviceStatus.get(event.id));
      },
    );
  };

  private onSenderReceiverChange(event: ResourceStoreEvent): void {
    if (event.type === "resource.removed") {
      const binding = this.store.getMonitorBinding(event.id);
      if (binding) {
        this.store.setMonitorBinding(event.id, undefined);
      }
      // Parent device may still have the monitor object; refresh when known.
      const deviceId =
        binding?.deviceId ??
        this.cache.getByResourceId(event.id)?.deviceId;
      if (deviceId) {
        this.scheduleHarvest(deviceId, `${event.resourceType}-removed`);
      }
      return;
    }

    const resource = event.resource as NmosSender | NmosReceiver;
    const previous =
      event.type === "resource.updated"
        ? (event.previous as NmosSender | NmosReceiver | undefined)
        : undefined;
    const versionChanged = previous?.version !== resource.version;
    if (event.type !== "resource.added" && !versionChanged) {
      return;
    }

    this.scheduleHarvest(
      resource.device_id,
      event.type === "resource.added"
        ? `${event.resourceType}-added`
        : `${event.resourceType}-version`,
    );
  }

  private onMonitorUpdated = (state: MonitorState): void => {
    if (!state.resourceId) {
      return;
    }
    this.store.setMonitorBinding(state.resourceId, {
      deviceId: state.deviceId,
      monitorOid: state.oid,
      overallStatus: overallStatusName(state.overallStatus),
      health: state.health,
    });
    this.emit("monitorUpdated", state);
  };

  private async syncDevice(
    device: NmosDevice,
    previous?: NmosDevice,
  ): Promise<void> {
    const endpoint = discoverNcpEndpoint(device);
    const log = childLogger(this.logger, { deviceId: device.id });

    if (endpoint.availability === "unavailable" || !endpoint.href) {
      log.info("Device has no usable NCP endpoint");
      await this.teardownDevice(device.id);
      this.deviceStatus.set(device.id, {
        deviceId: device.id,
        availability: "unavailable",
        href: endpoint.href,
        connected: false,
      });
      this.emit("deviceStatus", this.deviceStatus.get(device.id));
      return;
    }

    const existing = this.sessions.get(device.id);
    if (existing && existing.href === endpoint.href) {
      if (previous && previous.version !== device.version) {
        this.scheduleHarvest(device.id, "device-version");
      }
      return;
    }

    if (existing) {
      log.info(
        { from: existing.href, to: endpoint.href },
        "NCP href changed; reconnecting",
      );
      await this.teardownDevice(device.id);
    } else if (previous) {
      log.info("Opening NCP session for device");
    }

    await this.openSession(device.id, endpoint.href);
  }

  private async openSession(deviceId: Uuid, href: string): Promise<void> {
    const status: DeviceNcpStatus = {
      deviceId,
      availability: "available",
      href,
      connected: false,
    };
    this.deviceStatus.set(deviceId, status);

    const session = new Is12Session({
      href,
      deviceId,
      logger: this.logger,
      webSocketFactory: this.webSocketFactory,
      reconnectBaseMs: this.reconnectBaseMs,
      reconnectMaxMs: this.reconnectMaxMs,
      onReady: async (readySession) => {
        await this.harvestAndSubscribe(deviceId, readySession);
        this.continueRetriesIfIncomplete(deviceId, "post-ready");
      },
    });

    session.on("connected", () => {
      status.connected = true;
      status.lastError = undefined;
      this.emit("deviceStatus", status);
    });

    session.on("disconnected", () => {
      status.connected = false;
      this.clearHarvestSchedule(deviceId);
      for (const state of this.cache.listForDevice(deviceId)) {
        if (state.resourceId) {
          this.store.setMonitorBinding(state.resourceId, undefined);
        }
      }
      this.cache.clearDevice(deviceId);
      this.emit("deviceStatus", status);
    });

    session.on("reconnectScheduled", () => {
      incrementMetric("ncpReconnects");
    });

    session.on("malformedMessage", () => {
      incrementMetric("malformedIs12Messages");
    });

    session.on("notification", (notification) => {
      this.cache.applyNotification(notification, deviceId);
    });

    session.on("readyError", (error: unknown) => {
      status.lastError =
        error instanceof Error ? error.message : "IS-12 ready hook failed";
      this.emit("deviceStatus", status);
    });

    this.sessions.set(deviceId, { deviceId, href, session, status });
    session.connect();
  }

  /**
   * Schedule a device model re-harvest. External triggers reset the retry
   * counter; internal retries preserve it and use exponential backoff.
   */
  private scheduleHarvest(
    deviceId: Uuid,
    reason: string,
    options: { resetAttempts?: boolean } = {},
  ): void {
    if (!this.started) {
      return;
    }
    const entry = this.sessions.get(deviceId);
    if (!entry?.session.isOpen) {
      return;
    }

    const resetAttempts = options.resetAttempts !== false;
    let state = this.harvestSchedule.get(deviceId);
    if (!state) {
      state = { attempts: 0, inFlight: false, pending: false };
      this.harvestSchedule.set(deviceId, state);
    }
    if (resetAttempts) {
      state.attempts = 0;
    }

    if (state.timer) {
      clearTimeout(state.timer);
    }

    const delay =
      state.attempts === 0
        ? this.harvestDebounceMs
        : Math.min(
            this.harvestRetryBaseMs * 2 ** (state.attempts - 1),
            this.harvestRetryMaxMs,
          );

    this.logger.debug(
      { deviceId, reason, delayMs: delay, attempts: state.attempts },
      "Scheduling NCP monitor harvest",
    );

    state.timer = setTimeout(() => {
      void this.runScheduledHarvest(deviceId, reason);
    }, delay);
  }

  private async runScheduledHarvest(
    deviceId: Uuid,
    reason: string,
  ): Promise<void> {
    const state = this.harvestSchedule.get(deviceId);
    if (!state) {
      return;
    }
    state.timer = undefined;

    const entry = this.sessions.get(deviceId);
    if (!entry?.session.isOpen) {
      this.clearHarvestSchedule(deviceId);
      return;
    }

    if (state.inFlight) {
      state.pending = true;
      return;
    }

    state.inFlight = true;
    try {
      incrementMetric("ncpReharvests");
      await this.harvestAndSubscribe(deviceId, entry.session);
      this.continueRetriesIfIncomplete(deviceId, reason);
    } catch (error) {
      this.logger.error(
        { err: error, deviceId, reason },
        "Scheduled NCP harvest failed",
      );
      this.continueRetriesIfIncomplete(deviceId, `error:${reason}`);
    } finally {
      state.inFlight = false;
      if (state.pending) {
        state.pending = false;
        this.scheduleHarvest(deviceId, "coalesced", { resetAttempts: false });
      }
    }
  }

  private continueRetriesIfIncomplete(deviceId: Uuid, reason: string): void {
    if (!this.started || !this.sessions.get(deviceId)?.session.isOpen) {
      this.clearHarvestSchedule(deviceId);
      return;
    }

    if (!this.hasIncompleteBindings(deviceId)) {
      this.clearHarvestSchedule(deviceId);
      return;
    }

    let state = this.harvestSchedule.get(deviceId);
    if (!state) {
      state = { attempts: 0, inFlight: false, pending: false };
      this.harvestSchedule.set(deviceId, state);
    }
    state.attempts += 1;

    if (state.attempts >= this.harvestRetryMaxAttempts) {
      this.logger.warn(
        {
          deviceId,
          attempts: state.attempts,
          reason,
          unbound: this.listUnboundResourceIds(deviceId),
        },
        "Giving up NCP re-harvest retries; some senders/receivers still unbound",
      );
      this.clearHarvestSchedule(deviceId);
      return;
    }

    this.scheduleHarvest(deviceId, `retry:${reason}`, { resetAttempts: false });
  }

  private hasIncompleteBindings(deviceId: Uuid): boolean {
    return this.listUnboundResourceIds(deviceId).length > 0;
  }

  private listUnboundResourceIds(deviceId: Uuid): string[] {
    const unbound: string[] = [];
    for (const sender of this.store.getSendersForDevice(deviceId)) {
      if (!this.cache.getByResourceId(sender.id)) {
        unbound.push(sender.id);
      }
    }
    for (const receiver of this.store.getReceiversForDevice(deviceId)) {
      if (!this.cache.getByResourceId(receiver.id)) {
        unbound.push(receiver.id);
      }
    }
    return unbound;
  }

  private clearHarvestSchedule(deviceId: Uuid): void {
    const state = this.harvestSchedule.get(deviceId);
    if (!state) {
      return;
    }
    if (state.timer) {
      clearTimeout(state.timer);
    }
    this.harvestSchedule.delete(deviceId);
  }

  private async harvestAndSubscribe(
    deviceId: Uuid,
    session: Is12Session,
  ): Promise<void> {
    const log = childLogger(this.logger, { deviceId });
    const generation = (this.harvestGeneration.get(deviceId) ?? 0) + 1;
    this.harvestGeneration.set(deviceId, generation);

    const monitors = await harvestMonitors(session);
    log.info({ count: monitors.length }, "Harvested monitors from device model");

    const oids: number[] = [];
    const seenResourceIds = new Set<string>();
    const nextStates: MonitorState[] = [];

    for (const monitor of monitors) {
      try {
        const link = await resolveMonitorTouchpoint(
          session,
          monitor.oid,
          monitor.kind,
          this.logger,
        );

        if (seenResourceIds.has(link.resourceId)) {
          log.warn(
            {
              resourceId: link.resourceId,
              oid: monitor.oid,
              role: monitor.role,
            },
            "Duplicate monitor touchpoint for IS-04 resource",
          );
        }
        seenResourceIds.add(link.resourceId);

        const is04 =
          monitor.kind === "sender"
            ? this.store.getSender(link.resourceId)
            : this.store.getReceiver(link.resourceId);
        if (!is04) {
          log.warn(
            { resourceId: link.resourceId, kind: monitor.kind },
            "Monitor touchpoint references unknown IS-04 resource",
          );
        }

        const state = await this.cache.readMonitorState(
          session,
          deviceId,
          monitor,
          link,
        );
        nextStates.push(state);
        oids.push(monitor.oid);
      } catch (error) {
        log.warn(
          { err: error, oid: monitor.oid, role: monitor.role },
          "Skipping monitor without valid touchpoint",
        );
      }
    }

    if (this.harvestGeneration.get(deviceId) !== generation) {
      log.debug({ generation }, "Ignoring stale harvest result");
      return;
    }

    // Atomic per-device swap — never clears other devices; keeps prior state
    // visible until the new slice is ready.
    this.cache.replaceDevice(deviceId, nextStates);

    if (oids.length > 0) {
      const subscribed = await session.subscribe(oids);
      log.info({ subscribed }, "Subscribed to monitor property changes");
    }

    this.emit("harvested", {
      deviceId,
      monitors: this.cache.listForDevice(deviceId),
    });
  }

  private async teardownDevice(deviceId: Uuid): Promise<void> {
    this.clearHarvestSchedule(deviceId);
    const entry = this.sessions.get(deviceId);
    if (entry) {
      await entry.session.stop();
      this.sessions.delete(deviceId);
    }

    for (const state of this.cache.listForDevice(deviceId)) {
      if (state.resourceId) {
        this.store.setMonitorBinding(state.resourceId, undefined);
      }
    }
    this.cache.clearDevice(deviceId);
    this.deviceStatus.delete(deviceId);
    this.emit("deviceStatus", {
      deviceId,
      availability: "unavailable",
      connected: false,
    } satisfies DeviceNcpStatus);
  }
}

export function healthFromOverallStatus(
  overallStatus: number | string | null | undefined,
) {
  return mapOverallStatus(overallStatusName(overallStatus) ?? overallStatus);
}
