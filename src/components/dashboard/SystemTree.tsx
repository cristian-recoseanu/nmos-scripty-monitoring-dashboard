"use client";

import { memo, type ReactNode } from "react";

import type {
  SystemSnapshotDto,
  TreeEntityDto,
} from "@/server/domain/snapshot";
import type { EntityKind } from "@/server/domain";
import { EntityCard, hasMonitoringContext } from "./EntityCard";
import { ResourceGroupCard } from "./ResourceGroupCard";
import type { Selection } from "./useDashboardState";
import styles from "./SystemTree.module.css";

type BranchItem = { key: string; node: ReactNode };
type SelectableEntity = TreeEntityDto & { kind: EntityKind };
type DeviceEntity = TreeEntityDto & { kind: "device" };
type NodeEntity = TreeEntityDto & { kind: "node" };

/** Parent card with optional children joined by stem + sibling rail. */
function Branch({
  parent,
  items,
}: {
  parent: ReactNode;
  items?: BranchItem[];
}) {
  const hasChildren = (items?.length ?? 0) > 0;
  return (
    <div className={styles.branch}>
      {parent}
      {hasChildren ? (
        <>
          <div className={styles.stem} aria-hidden="true" />
          <div className={styles.children}>
            {items!.map((item) => (
              <div key={item.key} className={styles.childSlot}>
                {item.node}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

const DeviceBranch = memo(function DeviceBranch({
  device,
  selection,
  onSelect,
}: {
  device: DeviceEntity;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  return (
    <Branch
      parent={
        <EntityCard
          entity={device}
          selection={selection}
          onSelect={onSelect}
          showTransitions={hasMonitoringContext(device)}
        />
      }
      items={device.children?.map((child) => ({
        key: `${child.kind}:${child.id}`,
        node:
          child.kind === "group" ? (
            <ResourceGroupCard
              group={child}
              selection={selection}
              onSelect={onSelect}
            />
          ) : (
            <EntityCard
              entity={child as SelectableEntity}
              selection={selection}
              onSelect={onSelect}
              showTransitions={hasMonitoringContext(child)}
            />
          ),
      }))}
    />
  );
});

const NodeBranch = memo(function NodeBranch({
  node,
  selection,
  onSelect,
}: {
  node: NodeEntity;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  return (
    <Branch
      parent={
        <EntityCard
          entity={node}
          selection={selection}
          onSelect={onSelect}
          showTransitions={hasMonitoringContext(node)}
        />
      }
      items={node.children
        ?.filter((device): device is DeviceEntity => device.kind === "device")
        .map((device) => ({
          key: `${device.kind}:${device.id}`,
          node: (
            <DeviceBranch
              device={device}
              selection={selection}
              onSelect={onSelect}
            />
          ),
        }))}
    />
  );
});

export function SystemTree({
  system,
  selection,
  onSelect,
}: {
  system: SystemSnapshotDto["system"];
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const systemCard = (
    <EntityCard
      entity={{
        kind: "system",
        id: "system",
        label: system.label,
        health: system.health,
        totalTransitions: system.totalTransitions,
      }}
      selection={selection}
      onSelect={onSelect}
      showTransitions
    />
  );

  return (
    <div className={styles.chartScroll} aria-label="System organisation chart">
      <div className={styles.chart}>
        <Branch
          parent={systemCard}
          items={
            system.children.length > 0
              ? system.children
                  .filter((node): node is NodeEntity => node.kind === "node")
                  .map((node) => ({
                    key: `${node.kind}:${node.id}`,
                    node: (
                      <NodeBranch
                        node={node}
                        selection={selection}
                        onSelect={onSelect}
                      />
                    ),
                  }))
              : undefined
          }
        />

        {system.children.length === 0 ? (
          <p className={styles.empty}>No nodes in the registry yet.</p>
        ) : null}
      </div>
    </div>
  );
}
