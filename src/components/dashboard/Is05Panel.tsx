"use client";

import type { SelectionDetailDto } from "@/server/domain/snapshot";
import type {
  Is05ReceiverActive,
  Is05SenderActive,
} from "@/server/is05";
import { FieldList } from "./FieldList";
import styles from "./DetailPanel.module.css";

function isSenderActive(
  active: Is05SenderActive | Is05ReceiverActive,
): active is Is05SenderActive {
  return "receiver_id" in active;
}

export function Is05Panel({
  detail,
}: {
  detail: Extract<SelectionDetailDto, { kind: "sender" | "receiver" }>;
}) {
  const is05 = detail.is05;

  if (!is05) {
    return (
      <p className={styles.status}>
        IS-05 state has not been harvested yet for this resource.
      </p>
    );
  }

  if (is05.status === "skipped") {
    return (
      <p className={styles.status}>
        {is05.error ??
          "IS-05 harvest skipped (Phase 7 covers RTP transports only)."}
      </p>
    );
  }

  if (is05.status === "unavailable") {
    return (
      <p className={styles.status}>
        {is05.error ??
          "No IS-05 Connection API (urn:x-nmos:control:sr-ctrl) on the parent device."}
      </p>
    );
  }

  if (is05.status === "pending") {
    return <p className={styles.status}>Fetching IS-05 active parameters…</p>;
  }

  if (is05.status === "error" && !is05.active) {
    return (
      <p className={styles.errorInline} role="alert">
        {is05.error ?? "IS-05 harvest failed."}
      </p>
    );
  }

  const active = is05.active;
  const peerLabel = active
    ? isSenderActive(active)
      ? "Receiver ID"
      : "Sender ID"
    : "Peer ID";
  const peerValue = active
    ? isSenderActive(active)
      ? (active.receiver_id ?? "—")
      : (active.sender_id ?? "—")
    : "—";

  return (
    <div className={styles.is05}>
      {is05.error ? (
        <p className={styles.errorInline} role="alert">
          Last error: {is05.error}
        </p>
      ) : null}

      <FieldList
        fields={[
          { label: "Status", value: is05.status },
          {
            label: "Connection API",
            value: is05.connectionApiHref ?? "—",
          },
          {
            label: "Source IS-04 version",
            value: is05.sourceIs04Version ?? "—",
          },
          {
            label: "Fetched at",
            value: is05.fetchedAt
              ? new Date(is05.fetchedAt).toLocaleString()
              : "—",
          },
          {
            label: "Master enable",
            value: active ? String(active.master_enable) : "—",
          },
          { label: peerLabel, value: peerValue },
          {
            label: "Activation mode",
            value: active?.activation?.mode ?? "—",
          },
          {
            label: "Activation time",
            value: active?.activation?.activation_time ?? "—",
          },
        ]}
      />

      <h4 className={styles.sectionTitle}>Transport params</h4>
      {active?.transport_params?.length ? (
        <pre className={styles.codeBlock}>
          {JSON.stringify(active.transport_params, null, 2)}
        </pre>
      ) : (
        <p className={styles.status}>No transport_params in /active.</p>
      )}

      <h4 className={styles.sectionTitle}>Transport file</h4>
      {is05.transportFile?.data ? (
        <>
          <p className={styles.metaLine}>
            {is05.transportFile.contentType}
          </p>
          <pre className={styles.codeBlock}>{is05.transportFile.data}</pre>
        </>
      ) : (
        <p className={styles.status}>No transport file set.</p>
      )}
    </div>
  );
}
