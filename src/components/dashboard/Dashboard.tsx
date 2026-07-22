"use client";

import { Suspense, useState } from "react";

import type { SystemSnapshotDto } from "@/server/domain/snapshot";
import type { AppRuntimeStatus } from "@/server/runtime/app-runtime";
import { SystemTree } from "./SystemTree";
import { ConnectionsView } from "./ConnectionsView";
import { DetailPanel } from "./DetailPanel";
import { HealthBadge } from "./HealthBadge";
import { TransitionCount } from "./TransitionCount";
import { useDashboardState } from "./useDashboardState";
import styles from "./Dashboard.module.css";

function DashboardInner({
  initialSnapshot,
  initialStatus,
  configError,
}: {
  initialSnapshot: SystemSnapshotDto;
  initialStatus: AppRuntimeStatus;
  configError: string | null;
}) {
  const {
    snapshot,
    selection,
    setSelection,
    view,
    setView,
    detail,
    detailError,
    detailLoading,
    status,
    sseConnected,
  } = useDashboardState(initialSnapshot);

  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const registryConnected =
    status?.registry.connected ?? initialStatus.registry.connected;
  const registryError =
    configError ??
    status?.configError ??
    status?.registry.lastError ??
    snapshot.registry.lastError;
  const connections = snapshot.connections ?? {
    hubs: [],
    disconnected: [],
  };
  const connectionSenderCount = connections.hubs.length;
  const connectionDisconnectedCount = connections.disconnected.length;
  const connectionReceiverCount =
    connections.hubs.reduce((sum, hub) => sum + hub.receivers.length, 0) +
    connectionDisconnectedCount;

  async function resetSystemMonitors(): Promise<void> {
    setResetBusy(true);
    setResetError(null);
    setResetMessage(null);
    try {
      const response = await fetch("/api/system/reset-monitors", {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        reset?: number;
        skipped?: number;
        failures?: unknown[];
      };
      if (!response.ok) {
        throw new Error(body.error ?? `Reset failed (${response.status})`);
      }
      const failures = body.failures?.length ?? 0;
      setResetMessage(
        `Reset ${body.reset ?? 0} monitor(s)` +
          (body.skipped ? `, skipped ${body.skipped}` : "") +
          (failures ? `, ${failures} failed` : ""),
      );
      if (failures > 0) {
        setResetError(`${failures} monitor reset(s) failed`);
      }
    } catch (error) {
      setResetError(
        error instanceof Error ? error.message : "System-wide reset failed",
      );
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>NMOS System Monitoring Dashboard</h1>
          <p className={styles.subtitle}>
            IS-04 registry harvest · BCP-008 sender/receiver monitors
          </p>
        </div>
        <div className={styles.meta}>
          <HealthBadge health={snapshot.system.health} />
          <TransitionCount
            count={snapshot.system.totalTransitions}
            label="Total transitions"
          />
          <button
            type="button"
            className={styles.resetButton}
            disabled={resetBusy}
            onClick={() => void resetSystemMonitors()}
            title="ResetCountersAndMessages on all connected NCP monitors"
          >
            {resetBusy ? "Resetting…" : "Reset all"}
          </button>
          <span
            className={styles.pill}
            data-ok={registryConnected ? "true" : "false"}
          >
            Registry {registryConnected ? "connected" : "disconnected"}
          </span>
          <span
            className={styles.pill}
            data-ok={sseConnected ? "true" : "false"}
          >
            Live {sseConnected ? "on" : "off"}
          </span>
        </div>
      </header>

      {registryError ? (
        <div className={styles.banner} role="status">
          {registryError}
        </div>
      ) : null}
      {resetMessage ? (
        <div className={styles.bannerOk} role="status">
          {resetMessage}
        </div>
      ) : null}
      {resetError ? (
        <div className={styles.banner} role="alert">
          {resetError}
        </div>
      ) : null}

      <div className={styles.split}>
        <section className={styles.top} aria-label="Topology views">
          <div className={styles.panelHeader}>
            <div className={styles.tabs} role="tablist" aria-label="Topology">
              <button
                type="button"
                role="tab"
                aria-selected={view === "system"}
                className={styles.tab}
                data-active={view === "system" ? "true" : "false"}
                onClick={() => setView("system")}
              >
                System view
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "connections"}
                className={styles.tab}
                data-active={view === "connections" ? "true" : "false"}
                onClick={() => setView("connections")}
              >
                Connections view
              </button>
            </div>
            <span className={styles.panelMeta}>
              {view === "system"
                ? `${snapshot.system.childCount} node${snapshot.system.childCount === 1 ? "" : "s"}`
                : `${connectionSenderCount} Sender${connectionSenderCount === 1 ? "" : "s"}, ${connectionReceiverCount} receiver${connectionReceiverCount === 1 ? "" : "s"}, ${connectionDisconnectedCount} disconnected`}
            </span>
          </div>

          {!registryConnected && snapshot.system.childCount === 0 ? (
            <p className={styles.empty}>
              Waiting for the IS-04 Query API. Check registry host/port
              configuration, then watch this tree populate as grains arrive.
            </p>
          ) : null}

          <div className={styles.viewScroll}>
            {view === "system" ? (
              <SystemTree
                system={snapshot.system}
                selection={selection}
                onSelect={setSelection}
              />
            ) : (
              <ConnectionsView
                connections={connections}
                selection={selection}
                onSelect={setSelection}
              />
            )}
          </div>
        </section>

        <section className={styles.bottom} aria-label="Detail view">
          <div className={styles.panelHeader}>
            <h2>Detail</h2>
            {detailLoading ? (
              <span className={styles.panelMeta}>Refreshing…</span>
            ) : null}
          </div>
          <div className={styles.detailScroll}>
            <DetailPanel
              detail={detail}
              loading={detailLoading}
              error={detailError}
              onSelect={setSelection}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

export function Dashboard(props: {
  initialSnapshot: SystemSnapshotDto;
  initialStatus: AppRuntimeStatus;
  configError: string | null;
}) {
  return (
    <Suspense
      fallback={
        <div className={styles.shell}>
          <p className={styles.empty}>Loading dashboard…</p>
        </div>
      }
    >
      <DashboardInner {...props} />
    </Suspense>
  );
}
