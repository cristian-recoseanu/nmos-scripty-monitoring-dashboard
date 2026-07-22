import {
  ConfigError,
  loadConfig,
  summariseConfig,
  type AppConfig,
} from "@/config";
import {
  configureRootLogger,
  getRootLogger,
  type Logger,
} from "@/server/logging";
import { ResourceStore } from "@/server/is04";
import { Is04Orchestrator } from "@/server/is04/is04-orchestrator";
import { Is05Orchestrator } from "@/server/is05";
import { NcpOrchestrator } from "@/server/monitoring";
import {
  buildSelectionDetail,
  buildSystemSnapshot,
  type EntityKind,
  type SelectionDetailDto,
  type SystemSnapshotDto,
} from "@/server/domain/snapshot";
import { RuntimeEventBus } from "@/server/domain/event-bus";
import {
  buildRuntimeMetrics,
  markRuntimeStarted,
  type RuntimeMetrics,
} from "@/server/runtime/metrics";

const APP_VERSION = "0.1.0";
/** Debounce SSE snapshot fan-out under large-registry grain storms. */
const SNAPSHOT_DEBOUNCE_MS = 250;

export type AppRuntimeStatus = {
  started: boolean;
  configError?: string;
  registry:
    | ReturnType<Is04Orchestrator["getConnectionState"]>
    | {
        connected: false;
        queryApiBaseUrl?: string;
        lastError?: string;
        connectedPaths?: string[];
        retrying?: boolean;
      };
  metrics?: RuntimeMetrics;
  versions?: {
    app: string;
    node: string;
    next: string;
  };
};

/**
 * Process-wide singleton wiring config, IS-04 harvest, NCP monitoring,
 * snapshots, and SSE fan-out.
 *
 * Deployment assumption: a single Node.js process (or sticky singleton).
 * Multi-instance deployments would need shared state (out of scope).
 */
export class AppRuntime {
  private config?: AppConfig;
  private logger: Logger;
  private store: ResourceStore;
  private is04?: Is04Orchestrator;
  private ncp?: NcpOrchestrator;
  private is05?: Is05Orchestrator;
  private eventBus: RuntimeEventBus;
  private started = false;
  private starting?: Promise<void>;
  private configError?: string;

  constructor() {
    this.logger = getRootLogger();
    this.store = new ResourceStore();
    this.eventBus = new RuntimeEventBus(
      () => this.getSnapshot(),
      SNAPSHOT_DEBOUNCE_MS,
    );
  }

  getEventBus(): RuntimeEventBus {
    return this.eventBus;
  }

  getStore(): ResourceStore {
    return this.store;
  }

  getNcp(): NcpOrchestrator | undefined {
    return this.ncp;
  }

  getIs05(): Is05Orchestrator | undefined {
    return this.is05;
  }

  getMetrics(): RuntimeMetrics {
    const statuses = this.ncp?.listDeviceStatuses() ?? [];
    return buildRuntimeMetrics({
      resources: {
        nodes: this.store.listNodes().length,
        devices: this.store.listDevices().length,
        senders: this.store.listSenders().length,
        receivers: this.store.listReceivers().length,
        flows: this.store.listFlows().length,
        sources: this.store.listSources().length,
      },
      ncp: {
        sessions: this.ncp?.getOpenSessionCount() ?? 0,
        connected: statuses.filter((s) => s.connected).length,
        unavailableDevices: statuses.filter(
          (s) => s.availability === "unavailable",
        ).length,
      },
      is04ConnectedPaths:
        this.is04?.getConnectionState().connectedPaths.length ?? 0,
    });
  }

  getStatus(): AppRuntimeStatus {
    return {
      started: this.started,
      configError: this.configError,
      registry: this.is04?.getConnectionState() ?? {
        connected: false,
        queryApiBaseUrl: undefined,
        lastError: this.configError,
        connectedPaths: [],
        retrying: false,
      },
      metrics: this.started ? this.getMetrics() : undefined,
      versions: {
        app: APP_VERSION,
        node: process.version,
        next: "16.2.10",
      },
    };
  }

  async ensureStarted(): Promise<void> {
    if (this.started) {
      return;
    }
    if (this.starting) {
      return this.starting;
    }
    this.starting = this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async start(): Promise<void> {
    try {
      this.config = loadConfig();
    } catch (error) {
      this.configError =
        error instanceof ConfigError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Invalid configuration";
      this.logger.error({ err: error }, "Failed to load configuration");
      return;
    }

    this.logger = configureRootLogger({
      level: this.config.logLevel,
      pretty: process.env.NODE_ENV !== "production",
    });

    const versions = {
      app: APP_VERSION,
      node: process.version,
      next: "16.2.10",
    };
    this.logger.info(
      {
        config: summariseConfig(this.config),
        versions,
      },
      "NMOS monitoring runtime starting",
    );

    this.is04 = new Is04Orchestrator({
      config: this.config,
      store: this.store,
      logger: this.logger,
    });

    this.ncp = new NcpOrchestrator({
      store: this.store,
      logger: this.logger,
    });

    this.is05 = new Is05Orchestrator({
      store: this.store,
      logger: this.logger,
    });

    this.eventBus.setSnapshotBuilder(() => this.getSnapshot());

    this.store.on("change", () => this.eventBus.notifyChanged());
    this.ncp.on("monitorUpdated", () => this.eventBus.notifyChanged());
    this.ncp.on("deviceStatus", () => this.eventBus.notifyChanged());
    this.ncp.on("harvested", () => this.eventBus.notifyChanged());
    this.is05.on("updated", () => this.eventBus.notifyChanged());
    this.is05.on("removed", () => this.eventBus.notifyChanged());
    this.is04.on("connection", () => this.eventBus.notifyChanged());

    this.ncp.start();
    this.is05.start();

    try {
      await this.is04.start();
    } catch (error) {
      // Keep runtime up so the UI can show registry connection errors.
      this.logger.error({ err: error }, "IS-04 orchestrator failed to start");
    }

    markRuntimeStarted();
    this.started = true;
    this.eventBus.publishSnapshotNow();
    this.logger.info(
      { metrics: this.getMetrics(), versions },
      "App runtime started",
    );
  }

  async stop(): Promise<void> {
    await this.is05?.stop();
    await this.ncp?.stop();
    await this.is04?.stop();
    this.started = false;
    this.logger.info("App runtime stopped");
  }

  getSnapshot(): SystemSnapshotDto {
    return buildSystemSnapshot({
      store: this.store,
      getMonitor: (resourceId) => this.ncp?.cache.getByResourceId(resourceId),
      getDeviceNcpStatus: (deviceId) => this.ncp?.getDeviceStatus(deviceId),
      getIs05: (resourceId) => this.is05?.get(resourceId),
      registryConnected: this.is04?.getConnectionState().connected ?? false,
      queryApiBaseUrl:
        this.is04?.queryApiBaseUrl ??
        this.getStatus().registry.queryApiBaseUrl,
      registryLastError:
        this.configError ?? this.is04?.getConnectionState().lastError,
    });
  }

  getDetail(kind: EntityKind, id: string): SelectionDetailDto | undefined {
    return buildSelectionDetail(kind, id, {
      store: this.store,
      getMonitor: (resourceId) => this.ncp?.cache.getByResourceId(resourceId),
      getDeviceNcpStatus: (deviceId) => this.ncp?.getDeviceStatus(deviceId),
      getIs05: (resourceId) => this.is05?.get(resourceId),
      registryConnected: this.is04?.getConnectionState().connected ?? false,
      queryApiBaseUrl: this.is04?.queryApiBaseUrl,
      registryLastError:
        this.configError ?? this.is04?.getConnectionState().lastError,
    });
  }
}

const globalForRuntime = globalThis as typeof globalThis & {
  __nmosAppRuntime?: AppRuntime;
};

export function getAppRuntime(): AppRuntime {
  if (!globalForRuntime.__nmosAppRuntime) {
    globalForRuntime.__nmosAppRuntime = new AppRuntime();
  }
  return globalForRuntime.__nmosAppRuntime;
}

/** Test helper */
export function resetAppRuntime(): void {
  globalForRuntime.__nmosAppRuntime = undefined;
}
