"use client";

import { useMemo, useState } from "react";

import type { TreeEntityDto } from "@/server/domain/snapshot";
import { compareSeverity } from "@/lib/health";
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
  const worst = [...members].sort((a, b) =>
    compareSeverity(a.health, b.health),
  )[0];
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
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hovered = useMemo(
    () => members.find((member) => member.id === hoveredId),
    [members, hoveredId],
  );
  const preview = hovered ?? pinned;

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
        onMouseLeave={() => setHoveredId(null)}
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
              onMouseEnter={() => setHoveredId(member.id)}
              onFocus={() => setHoveredId(member.id)}
              onBlur={() => setHoveredId((current) => (current === member.id ? null : current))}
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

      {preview ? (
        <div
          className={`${styles.pinned} ${hovered ? styles.pinnedPreview : ""}`}
          data-preview={hovered ? "true" : "false"}
        >
          <span className={styles.pinnedIcons}>
            {preview.meta?.format ? (
              <FormatIcon format={preview.meta.format} />
            ) : null}
          </span>
          <span className={styles.pinnedLabel} title={preview.label}>
            {preview.label}
          </span>
          {!hovered ? (
            <TransitionCount count={preview.totalTransitions ?? 0} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
