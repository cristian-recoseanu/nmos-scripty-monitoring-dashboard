import type { ResourceStore } from "@/server/is04";
import type { AckableKind } from "@/server/domain/acknowledgement-store";
import type {
  EntityKind,
  SelectionDetailDto,
  SystemSnapshotDto,
} from "@/server/domain/snapshot";
import type { HealthAggregatorInput } from "@/server/domain/health-aggregator";
import type { Is05CacheEntry } from "@/server/is05/types";
import type { AppRuntimeStatus } from "@/server/runtime/app-runtime";
import type { Logger } from "@/server/logging";

/**
 * Read-only façade over AppRuntime / domain builders for MCP tools.
 * Tools must not open their own IS-04 / IS-05 / NCP clients.
 */
export type McpContext = {
  getSnapshot: () => SystemSnapshotDto;
  getDetail: (kind: EntityKind, id: string) => SelectionDetailDto | undefined;
  getStatus: () => AppRuntimeStatus;
  getStore: () => ResourceStore;
  getMonitor: HealthAggregatorInput["getMonitor"];
  getDeviceNcpStatus: HealthAggregatorInput["getDeviceNcpStatus"];
  getIs05: (resourceId: string) => Is05CacheEntry | undefined;
  isAcknowledged: (kind: AckableKind, id: string) => boolean;
  logger: Logger;
};
