"use client";

import { useMemo, type ReactNode } from "react";

import type {
  ConnectionHubDto,
  ConnectionsSnapshotDto,
  LeafTreeEntityDto,
} from "@/server/domain/snapshot";
import { EntityCard, hasMonitoringContext } from "./EntityCard";
import { HealthBadge } from "./HealthBadge";
import { FormatIcon } from "./FormatIcon";
import { TransitionCount } from "./TransitionCount";
import type { Selection } from "./useDashboardState";
import styles from "./ConnectionsView.module.css";

function pickPinned(
  members: LeafTreeEntityDto[],
  selection: Selection,
): LeafTreeEntityDto | undefined {
  const selected = members.find(
    (member) =>
      member.kind === "receiver" &&
      selection.kind === "receiver" &&
      selection.id === member.id,
  );
  if (selected) {
    return selected;
  }
  const worst = [...members].sort((a, b) => {
    const rank = {
      unhealthy: 0,
      degraded: 1,
      unknown: 2,
      healthy: 3,
      inactive: 4,
    };
    return rank[a.health] - rank[b.health];
  })[0];
  return worst ?? members[0];
}

/** Compact receiver strip + one pinned card (scales to large fan-outs). */
function ReceiverStrip({
  receivers,
  selection,
  onSelect,
}: {
  receivers: LeafTreeEntityDto[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const pinned = useMemo(
    () => pickPinned(receivers, selection),
    [receivers, selection],
  );

  return (
    <div className={styles.stripPanel}>
      <span className={styles.link} aria-hidden="true" />
      <div className={styles.stripCard}>
        <div className={styles.stripHeader}>
          <span className={styles.stripTitle}>Receivers</span>
          <span
            className={styles.stripCount}
            title={`${receivers.length} ${receivers.length === 1 ? "receiver" : "receivers"}`}
          >
            {receivers.length}
          </span>
        </div>
        <p className={styles.stripHint}>Click a light to select</p>
        <div
          className={styles.strip}
          role="group"
          aria-label="Receivers — click a light to select"
        >
          {receivers.map((receiver) => {
            const isSelected =
              selection.kind === "receiver" && selection.id === receiver.id;
            return (
              <button
                key={receiver.id}
                type="button"
                className={`${styles.light} ${isSelected ? styles.lightSelected : ""}`}
                title={`${isSelected ? "Selected: " : "Select: "}${receiver.label} (${receiver.health})`}
                aria-label={`${isSelected ? "Selected" : "Select"} ${receiver.label}`}
                aria-pressed={isSelected}
                onClick={() =>
                  onSelect({ kind: "receiver", id: receiver.id })
                }
              >
                <HealthBadge
                  health={receiver.health}
                  size="sm"
                  showLabel={false}
                />
              </button>
            );
          })}
        </div>
        {pinned ? (
          <div className={styles.pinned}>
            <span className={styles.pinnedIcons}>
              {pinned.meta?.format ? (
                <FormatIcon format={pinned.meta.format} />
              ) : null}
            </span>
            <span className={styles.pinnedLabel} title={pinned.label}>
              {pinned.label}
            </span>
            {hasMonitoringContext(pinned) ? (
              <TransitionCount count={pinned.totalTransitions ?? 0} />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OrbitGroup({
  hub,
  selection,
  onSelect,
}: {
  hub: { anchor: ReactNode; receivers: LeafTreeEntityDto[] };
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const count = hub.receivers.length;

  return (
    <div className={styles.hub}>
      <div className={styles.anchor}>{hub.anchor}</div>
      {count === 0 ? (
        <div className={styles.emptyOrbit} aria-hidden="true" />
      ) : (
        <ReceiverStrip
          receivers={hub.receivers}
          selection={selection}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function SenderHub({
  hub,
  selection,
  onSelect,
}: {
  hub: ConnectionHubDto;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  return (
    <OrbitGroup
      selection={selection}
      onSelect={onSelect}
      hub={{
        anchor: (
          <EntityCard
            entity={hub.sender}
            selection={selection}
            onSelect={onSelect}
            showTransitions={hasMonitoringContext(hub.sender)}
          />
        ),
        receivers: hub.receivers,
      }}
    />
  );
}

export function ConnectionsView({
  connections,
  selection,
  onSelect,
}: {
  connections: ConnectionsSnapshotDto;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const empty =
    connections.hubs.length === 0 && connections.disconnected.length === 0;

  return (
    <div className={styles.scroll} aria-label="Connections view">
      {empty ? (
        <p className={styles.empty}>
          No senders or receivers in the registry yet.
        </p>
      ) : (
        <div className={styles.layout}>
          <div className={styles.hubs}>
            {connections.hubs.map((hub) => (
              <SenderHub
                key={hub.sender.id}
                hub={hub}
                selection={selection}
                onSelect={onSelect}
              />
            ))}
          </div>

          <section className={styles.disconnected} aria-label="Disconnected">
            <OrbitGroup
              selection={selection}
              onSelect={onSelect}
              hub={{
                anchor: (
                  <div className={styles.placeholder}>
                    <span className={styles.placeholderTitle}>Disconnected</span>
                    <span className={styles.placeholderMeta}>
                      {connections.disconnected.length} receiver
                      {connections.disconnected.length === 1 ? "" : "s"}
                    </span>
                  </div>
                ),
                receivers: connections.disconnected,
              }}
            />
          </section>
        </div>
      )}
    </div>
  );
}
