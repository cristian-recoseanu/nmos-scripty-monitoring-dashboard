"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  ConnectionHubDto,
  ConnectionsSnapshotDto,
  TreeEntityDto,
} from "@/server/domain/snapshot";
import { EntityCard, hasMonitoringContext } from "./EntityCard";
import type { Selection } from "./useDashboardState";
import styles from "./ConnectionsView.module.css";

const LINK_WIDTH_PX = 56;

function ReceiverCard({
  receiver,
  selection,
  onSelect,
}: {
  receiver: TreeEntityDto;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  return (
    <EntityCard
      entity={receiver}
      selection={selection}
      onSelect={onSelect}
      showTransitions={hasMonitoringContext(receiver)}
    />
  );
}

/** Fan of 2+ receivers with SVG spokes from the hub join to each card. */
function ReceiverFan({
  receivers,
  selection,
  onSelect,
}: {
  receivers: TreeEntityDto[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const stackRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<{
    height: number;
    targets: number[];
  }>({ height: 0, targets: [] });

  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) {
      return;
    }

    const measure = () => {
      const stackRect = stack.getBoundingClientRect();
      const targets = Array.from(stack.children, (child) => {
        const rect = (child as HTMLElement).getBoundingClientRect();
        return rect.top + rect.height / 2 - stackRect.top;
      });
      setGeometry({ height: stackRect.height, targets });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stack);
    for (const child of stack.children) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [receivers]);

  const hubY = geometry.height / 2;

  return (
    <div className={styles.fan}>
      <svg
        className={styles.wires}
        width={LINK_WIDTH_PX}
        height={Math.max(geometry.height, 1)}
        aria-hidden="true"
      >
        {geometry.targets.map((y, index) => (
          <line
            key={receivers[index]?.id ?? index}
            className={styles.wire}
            x1={0}
            y1={hubY}
            x2={LINK_WIDTH_PX}
            y2={y}
          />
        ))}
      </svg>
      <div ref={stackRef} className={styles.stack}>
        {receivers.map((receiver) => (
          <ReceiverCard
            key={receiver.id}
            receiver={receiver}
            selection={selection}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function OrbitGroup({
  hub,
  selection,
  onSelect,
}: {
  hub: { anchor: ReactNode; receivers: TreeEntityDto[] };
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const count = hub.receivers.length;

  return (
    <div className={styles.hub}>
      <div className={styles.anchor}>{hub.anchor}</div>
      {count === 0 ? (
        <div className={styles.emptyOrbit} aria-hidden="true" />
      ) : count === 1 ? (
        <div className={styles.single}>
          <span className={styles.link} aria-hidden="true" />
          <ReceiverCard
            receiver={hub.receivers[0]!}
            selection={selection}
            onSelect={onSelect}
          />
        </div>
      ) : (
        <ReceiverFan
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
