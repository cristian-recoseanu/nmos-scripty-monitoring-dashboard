import { EventEmitter } from "node:events";

import type { Logger } from "@/server/logging";
import { childLogger } from "@/server/logging";
import {
  Is12Session,
  type WebSocketFactory,
} from "@/server/is12";
import type {
  NmosDevice,
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

export type NcpOrchestratorOptions = {
  store: ResourceStore;
  logger: Logger;
  webSocketFactory?: WebSocketFactory;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
};

/**
 * Watches the resource store for devices, opens one IS-12 session per NCP
 * endpoint, harvests monitors, binds touchpoints, and caches status updates.
 */
export class NcpOrchestrator extends EventEmitter {
  private readonly store: ResourceStore;
  private readonly logger: Logger;
  private readonly webSocketFactory?: WebSocketFactory;
  private readonly reconnectBaseMs?: number;
  private readonly reconnectMaxMs?: number;
  private readonly sessions = new Map<Uuid, DeviceSession>();
  private readonly deviceStatus = new Map<Uuid, DeviceNcpStatus>();
  private readonly harvestGeneration = new Map<Uuid, number>();
  readonly cache = new MonitorCache();
  private started = false;

  constructor(options: NcpOrchestratorOptions) {
    super();
    this.store = options.store;
    this.logger = childLogger(options.logger, { component: "ncp-orchestrator" });
    this.webSocketFactory = options.webSocketFactory;
    this.reconnectBaseMs = options.reconnectBaseMs;
    this.reconnectMaxMs = options.reconnectMaxMs;
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
        failures.push({
          deviceId: state.deviceId,
          oid: state.oid,
          error: error instanceof Error ? error.message : "Reset failed",
        });
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
      },
    });

    session.on("connected", () => {
      status.connected = true;
      status.lastError = undefined;
      this.emit("deviceStatus", status);
    });

    session.on("disconnected", () => {
      status.connected = false;
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
