import type { EntityKind } from "@/server/domain/snapshot";
import styles from "./KindIcon.module.css";

const TITLES: Record<EntityKind, string> = {
  system: "System",
  node: "Node",
  device: "Device",
  sender: "Sender",
  receiver: "Receiver",
};

export function KindIcon({ kind }: { kind: EntityKind }) {
  return (
    <span
      className={styles.icon}
      data-kind={kind}
      title={TITLES[kind]}
      aria-label={TITLES[kind]}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        {kind === "system" ? (
          <path
            fill="currentColor"
            d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v2A1.5 1.5 0 0 1 12.5 7h-9A1.5 1.5 0 0 1 2 5.5v-2Zm0 7A1.5 1.5 0 0 1 3.5 9h9a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-2Z"
          />
        ) : null}
        {kind === "node" ? (
          <path
            fill="currentColor"
            d="M8 1.5 14 5v6L8 14.5 2 11V5L8 1.5Zm0 2.2L4 5.9v4.2L8 12.3l4-2.2V5.9L8 3.7Z"
          />
        ) : null}
        {kind === "device" ? (
          <path
            fill="currentColor"
            d="M3 3.5A1.5 1.5 0 0 1 4.5 2h7A1.5 1.5 0 0 1 13 3.5v7A1.5 1.5 0 0 1 11.5 12H9.8l.7 1.5h-4L7.2 12H4.5A1.5 1.5 0 0 1 3 10.5v-7Zm1.5.5v6h7v-6h-7Z"
          />
        ) : null}
        {kind === "sender" ? (
          <path
            fill="currentColor"
            d="M2.5 7.25h7.2L7.35 4.9l1.05-1.05L12.7 8l-4.3 4.15-1.05-1.05 2.35-2.35H2.5v-1.5Z"
          />
        ) : null}
        {kind === "receiver" ? (
          <path
            fill="currentColor"
            d="M13.5 8.75H6.3l2.35 2.35-1.05 1.05L3.3 8l4.3-4.15 1.05 1.05L6.3 7.25h7.2v1.5Z"
          />
        ) : null}
      </svg>
    </span>
  );
}
