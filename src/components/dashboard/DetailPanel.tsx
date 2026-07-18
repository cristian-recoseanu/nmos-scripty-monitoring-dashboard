"use client";

import type { SelectionDetailDto } from "@/server/domain/snapshot";
import { HealthBadge } from "./HealthBadge";
import { FieldList } from "./FieldList";
import { ContributorsList } from "./ContributorsList";
import { MonitorPanel } from "./MonitorPanel";
import { TransitionCount } from "./TransitionCount";
import type { Selection } from "./useDashboardState";
import styles from "./DetailPanel.module.css";

export function DetailPanel({
  detail,
  loading,
  error,
  onSelect,
}: {
  detail: SelectionDetailDto | null;
  loading: boolean;
  error: string | null;
  onSelect: (selection: Selection) => void;
}) {
  if (loading && !detail) {
    return <p className={styles.status}>Loading details…</p>;
  }

  if (error && !detail) {
    return (
      <p className={styles.error} role="alert">
        {error}
      </p>
    );
  }

  if (!detail) {
    return (
      <p className={styles.status}>
        Select a system, node, device, sender, or receiver in the tree above.
      </p>
    );
  }

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <div>
          <p className={styles.kind}>{detail.kind}</p>
          <h3 className={styles.title}>{detail.label}</h3>
        </div>
        <div className={styles.headerMeta}>
          {"totalTransitions" in detail ? (
            <TransitionCount
              count={detail.totalTransitions}
              label="Total transitions"
            />
          ) : null}
          <HealthBadge health={detail.health} />
        </div>
      </header>

      {error ? (
        <p className={styles.errorInline} role="alert">
          {error}
        </p>
      ) : null}

      {detail.kind === "system" ? (
        <ContributorsList
          title="Worst nodes contributing to system state"
          contributors={detail.worstContributors}
          onSelect={onSelect}
        />
      ) : null}

      {detail.kind === "node" ? (
        <>
          <FieldList
            fields={[
              { label: "ID", value: detail.resource.id },
              { label: "Version", value: detail.resource.version },
              { label: "Description", value: detail.resource.description || "—" },
              { label: "Href", value: detail.resource.href },
              {
                label: "Hostname",
                value: detail.resource.hostname ?? "—",
              },
              {
                label: "API versions",
                value: detail.resource.api?.versions?.join(", ") ?? "—",
              },
            ]}
          />
          <ContributorsList
            title="Worst devices contributing to node state"
            contributors={detail.worstContributors}
            onSelect={onSelect}
          />
        </>
      ) : null}

      {detail.kind === "device" ? (
        <>
          <FieldList
            fields={[
              { label: "ID", value: detail.resource.id },
              { label: "Version", value: detail.resource.version },
              { label: "Type", value: detail.resource.type },
              { label: "Node ID", value: detail.resource.node_id },
              { label: "Description", value: detail.resource.description || "—" },
              {
                label: "NCP",
                value: `${detail.ncp.availability}${detail.ncp.connected ? " · connected" : " · disconnected"}`,
              },
              { label: "NCP href", value: detail.ncp.href ?? "—" },
              { label: "NCP type", value: detail.ncp.controlType ?? "—" },
              {
                label: "NCP error",
                value: detail.ncp.lastError ?? "—",
              },
              {
                label: "Controls",
                value:
                  detail.resource.controls
                    ?.map((control) => `${control.type} → ${control.href}`)
                    .join("\n") || "—",
              },
            ]}
          />
          <ContributorsList
            title="Worst senders & receivers contributing to device state"
            contributors={detail.worstContributors}
            onSelect={onSelect}
          />
        </>
      ) : null}

      {detail.kind === "sender" ? (
        <>
          <FieldList
            fields={[
              { label: "ID", value: detail.resource.id },
              { label: "Version", value: detail.resource.version },
              { label: "Device ID", value: detail.resource.device_id },
              { label: "Transport", value: detail.resource.transport },
              { label: "Flow ID", value: detail.resource.flow_id ?? "—" },
              {
                label: "Description",
                value: detail.resource.description || "—",
              },
              {
                label: "Flow",
                value: detail.flow
                  ? `${detail.flow.label} (${detail.flow.id}) · ${detail.flow.format}`
                  : "—",
              },
              {
                label: "Source",
                value: detail.source
                  ? `${detail.source.label} (${detail.source.id})`
                  : "—",
              },
            ]}
          />
          {detail.monitor ? (
            <MonitorPanel deviceId={detail.deviceId} monitor={detail.monitor} />
          ) : (
            <p className={styles.status}>No sender monitor bound via touchpoints.</p>
          )}
        </>
      ) : null}

      {detail.kind === "receiver" ? (
        <>
          <FieldList
            fields={[
              { label: "ID", value: detail.resource.id },
              { label: "Version", value: detail.resource.version },
              { label: "Device ID", value: detail.resource.device_id },
              { label: "Transport", value: detail.resource.transport },
              {
                label: "Description",
                value: detail.resource.description || "—",
              },
              {
                label: "Subscription active",
                value: String(detail.resource.subscription.active),
              },
              {
                label: "Sender ID",
                value: detail.resource.subscription.sender_id ?? "—",
              },
              {
                label: "Connected sender",
                value: detail.connectedSender ? (
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() =>
                      onSelect({
                        kind: "sender",
                        id: detail.connectedSender!.id,
                      })
                    }
                  >
                    {detail.connectedSender.label} (
                    {detail.connectedSender.health})
                  </button>
                ) : (
                  "—"
                ),
              },
            ]}
          />
          {detail.monitor ? (
            <MonitorPanel deviceId={detail.deviceId} monitor={detail.monitor} />
          ) : (
            <p className={styles.status}>
              No receiver monitor bound via touchpoints.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
