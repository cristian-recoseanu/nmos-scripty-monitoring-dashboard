"use client";

import { useState } from "react";

import type { SelectionDetailDto } from "@/server/domain/snapshot";
import { HealthBadge } from "./HealthBadge";
import { FieldList } from "./FieldList";
import { ContributorsList } from "./ContributorsList";
import { MonitorPanel } from "./MonitorPanel";
import { TransitionCount } from "./TransitionCount";
import { Is05Panel } from "./Is05Panel";
import type { Selection } from "./useDashboardState";
import styles from "./DetailPanel.module.css";

type ResourceTab = "bcp008" | "is04" | "is05";

function SenderReceiverTabs({
  detail,
  onSelect,
}: {
  detail: Extract<SelectionDetailDto, { kind: "sender" | "receiver" }>;
  onSelect: (selection: Selection) => void;
}) {
  const [tab, setTab] = useState<ResourceTab>("bcp008");

  return (
    <div>
      <div className={styles.tabs} role="tablist" aria-label="Resource details">
        {(
          [
            ["bcp008", "BCP-008"],
            ["is04", "IS-04"],
            ["is05", "IS-05"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? styles.tabActive : styles.tab}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "bcp008" ? (
        detail.monitor ? (
          <MonitorPanel deviceId={detail.deviceId} monitor={detail.monitor} />
        ) : (
          <p className={styles.status}>
            No {detail.kind} monitor bound via touchpoints.
          </p>
        )
      ) : null}

      {tab === "is04" ? (
        detail.kind === "sender" ? (
          <>
            <h4 className={styles.sectionTitle}>Sender</h4>
            <FieldList
              fields={[
                { label: "ID", value: detail.resource.id },
                { label: "Version", value: detail.resource.version },
                { label: "Label", value: detail.resource.label || "—" },
                {
                  label: "Description",
                  value: detail.resource.description || "—",
                },
                { label: "Device ID", value: detail.resource.device_id },
                { label: "Transport", value: detail.resource.transport },
                { label: "Flow ID", value: detail.resource.flow_id ?? "—" },
                {
                  label: "Interface bindings",
                  value: detail.resource.interface_bindings?.join(", ") || "—",
                },
                {
                  label: "Manifest href",
                  value: detail.resource.manifest_href ?? "—",
                },
                {
                  label: "Subscription active",
                  value:
                    detail.resource.subscription?.active === undefined
                      ? "—"
                      : String(detail.resource.subscription.active),
                },
                {
                  label: "Subscription receiver",
                  value: detail.resource.subscription?.receiver_id ?? "—",
                },
              ]}
            />
            <h4 className={styles.sectionTitle}>Flow</h4>
            {detail.flow ? (
              <FieldList
                fields={[
                  { label: "ID", value: detail.flow.id },
                  { label: "Version", value: detail.flow.version },
                  { label: "Label", value: detail.flow.label || "—" },
                  {
                    label: "Description",
                    value: detail.flow.description || "—",
                  },
                  { label: "Format", value: detail.flow.format },
                  { label: "Source ID", value: detail.flow.source_id },
                  { label: "Device ID", value: detail.flow.device_id },
                  {
                    label: "Parents",
                    value: detail.flow.parents?.join(", ") || "—",
                  },
                ]}
              />
            ) : (
              <p className={styles.status}>No associated flow in the registry.</p>
            )}
            <h4 className={styles.sectionTitle}>Source</h4>
            {detail.source ? (
              <FieldList
                fields={[
                  { label: "ID", value: detail.source.id },
                  { label: "Version", value: detail.source.version },
                  { label: "Label", value: detail.source.label || "—" },
                  {
                    label: "Description",
                    value: detail.source.description || "—",
                  },
                  { label: "Format", value: detail.source.format ?? "—" },
                  {
                    label: "Clock name",
                    value: detail.source.clock_name ?? "—",
                  },
                  {
                    label: "Device ID",
                    value: detail.source.device_id ?? "—",
                  },
                  {
                    label: "Parents",
                    value: detail.source.parents?.join(", ") || "—",
                  },
                ]}
              />
            ) : (
              <p className={styles.status}>
                No associated source in the registry.
              </p>
            )}
          </>
        ) : (
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
        )
      ) : null}

      {tab === "is05" ? <Is05Panel detail={detail} /> : null}
    </div>
  );
}

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

      {detail.kind === "sender" || detail.kind === "receiver" ? (
        <SenderReceiverTabs
          key={`${detail.kind}:${detail.id}`}
          detail={detail}
          onSelect={onSelect}
        />
      ) : null}
    </div>
  );
}
