"use client";

import { useMemo } from "react";

import type { TreeEntityDto } from "@/server/domain/snapshot";
import { HealthBadge } from "./HealthBadge";
import { FormatIcon } from "./FormatIcon";
import { TransitionCount } from "./TransitionCount";
import type { Selection } from "./useDashboardState";
import styles from "./ResourceGroupCard.module.css";

function pickPinned(
  members: TreeEntityDto[],
  selection: Selection,
): TreeEntityDto | undefined {
  const selected = members.find(
    (member) =>
      (member.kind === "sender" || member.kind === "receiver") &&
      selection.kind === member.kind &&
      selection.id === member.id,
  );
  if (selected) {
    return selected;
  }
  const worst = [...members].sort((a, b) => {
    const rank = { unhealthy: 0, degraded: 1, unknown: 2, healthy: 3, inactive: 4 };
    return rank[a.health] - rank[b.health];
  })[0];
  return worst ?? members[0];
}

/**
 * Compact Senders/Receivers group: traffic-light strip selects the pinned
 * instance (label + transition sum); detail selection uses sender/receiver id.
 */
export function ResourceGroupCard({
  group,
  selection,
  onSelect,
}: {
  group: TreeEntityDto;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const members = useMemo(() => group.children ?? [], [group.children]);
  const pinned = useMemo(
    () => pickPinned(members, selection),
    [members, selection],
  );

  return (
    <div
      className={styles.card}
      data-group={group.meta?.group ?? "senders"}
      aria-label={`${group.label} (${members.length})`}
    >
      <div className={styles.header}>
        <span className={styles.title}>{group.label}</span>
        <span
          className={styles.count}
          title={`${members.length} ${members.length === 1 ? "item" : "items"}`}
        >
          {members.length}
        </span>
      </div>

      <p className={styles.stripHint}>Click a light to select</p>

      <div
        className={styles.strip}
        role="group"
        aria-label={`${group.label} — click a light to select`}
      >
        {members.map((member) => {
          const isSelected =
            (member.kind === "sender" || member.kind === "receiver") &&
            selection.kind === member.kind &&
            selection.id === member.id;
          return (
            <button
              key={member.id}
              type="button"
              className={`${styles.light} ${isSelected ? styles.lightSelected : ""}`}
              title={`${isSelected ? "Selected: " : "Select: "}${member.label} (${member.health})`}
              aria-label={`${isSelected ? "Selected" : "Select"} ${member.label}`}
              aria-pressed={isSelected}
              onClick={() => {
                if (member.kind === "sender" || member.kind === "receiver") {
                  onSelect({ kind: member.kind, id: member.id });
                }
              }}
            >
              <HealthBadge health={member.health} size="sm" showLabel={false} />
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
          <TransitionCount count={pinned.totalTransitions ?? 0} />
        </div>
      ) : null}
    </div>
  );
}
