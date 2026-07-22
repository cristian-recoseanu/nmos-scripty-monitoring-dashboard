"use client";

import type { TreeEntityDto } from "@/server/domain/snapshot";
import { HealthBadge } from "./HealthBadge";
import { FormatIcon } from "./FormatIcon";
import { KindIcon } from "./KindIcon";
import { TransitionCount } from "./TransitionCount";
import type { Selection } from "./useDashboardState";
import styles from "./EntityCard.module.css";

export function hasMonitoringContext(
  entity: Pick<TreeEntityDto, "kind" | "meta" | "children">,
): boolean {
  if (entity.kind === "sender" || entity.kind === "receiver") {
    return entity.meta?.hasMonitor === true;
  }
  if (entity.kind === "group") {
    return (entity.children ?? []).some(hasMonitoringContext);
  }
  if (entity.kind === "device") {
    return (
      entity.meta?.ncpAvailability === "available" ||
      (entity.children ?? []).some(hasMonitoringContext)
    );
  }
  if (entity.kind === "node") {
    return (entity.children ?? []).some(hasMonitoringContext);
  }
  return false;
}

export function EntityCard({
  entity,
  selection,
  onSelect,
  showTransitions,
}: {
  entity: {
    kind: Exclude<TreeEntityDto["kind"], "group">;
    id: string;
    label: string;
    health: TreeEntityDto["health"];
    totalTransitions?: number;
    meta?: TreeEntityDto["meta"];
    children?: TreeEntityDto["children"];
  };
  selection: Selection;
  onSelect: (selection: Selection) => void;
  showTransitions: boolean;
}) {
  const selected =
    selection.kind === entity.kind && selection.id === entity.id;
  const missingMonitor =
    (entity.kind === "sender" || entity.kind === "receiver") &&
    entity.meta?.hasMonitor === false;
  const showNcpPill =
    entity.kind === "device" && entity.meta?.ncpAvailability === "available";
  const ncpUnavailable =
    entity.kind === "device" &&
    (entity.meta?.ncpAvailability === "unavailable" ||
      entity.meta?.ncpAvailability === "unknown");

  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.selected : ""}`}
      onClick={() => onSelect({ kind: entity.kind, id: entity.id })}
      aria-pressed={selected}
    >
      <span className={styles.cardTop}>
        <span className={styles.cardIcons}>
          <KindIcon kind={entity.kind} />
          {entity.meta?.format ? (
            <FormatIcon format={entity.meta.format} />
          ) : null}
        </span>
        <HealthBadge health={entity.health} size="sm" showLabel={false} />
      </span>
      <span className={styles.cardLabel}>{entity.label}</span>
      <span className={styles.cardMeta}>
        {showTransitions ? (
          <TransitionCount count={entity.totalTransitions ?? 0} />
        ) : null}
        {missingMonitor ? (
          <span className={styles.hint} title="No BCP-008 monitor bound">
            no monitor
          </span>
        ) : null}
        {ncpUnavailable ? (
          <span className={styles.hint} title="No IS-12 NCP endpoint">
            no NCP
          </span>
        ) : null}
        {showNcpPill ? (
          <span
            className={styles.ncpPill}
            data-connected={entity.meta?.ncpConnected ? "true" : "false"}
            title={
              entity.meta?.ncpConnected
                ? "NCP WebSocket connected"
                : "NCP WebSocket disconnected"
            }
          >
            NCP
          </span>
        ) : null}
      </span>
    </button>
  );
}
