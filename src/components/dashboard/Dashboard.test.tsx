/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { HealthBadge } from "./HealthBadge";
import { SystemTree } from "./SystemTree";
import { DetailPanel } from "./DetailPanel";
import { ContributorsList } from "./ContributorsList";
import type { SystemSnapshotDto, SelectionDetailDto } from "@/server/domain/snapshot";

const snapshotSystem: SystemSnapshotDto["system"] = {
  kind: "system",
  id: "system",
  label: "System",
  health: "degraded",
  childCount: 1,
  totalTransitions: 5,
  children: [
    {
      kind: "node",
      id: "node-1",
      label: "Node A",
      health: "degraded",
      childCount: 1,
      totalTransitions: 5,
      children: [
        {
          kind: "device",
          id: "device-1",
          label: "Device A",
          health: "degraded",
          childCount: 2,
          totalTransitions: 5,
          meta: { ncpAvailability: "available", ncpConnected: true },
          children: [
            {
              kind: "sender",
              id: "sender-1",
              label: "Tx 1",
              health: "healthy",
              childCount: 0,
              totalTransitions: 1,
              meta: { hasMonitor: true, format: "video" },
            },
            {
              kind: "receiver",
              id: "receiver-1",
              label: "Rx 1",
              health: "degraded",
              childCount: 0,
              totalTransitions: 4,
              meta: { hasMonitor: false, format: "audio" },
            },
          ],
        },
      ],
    },
  ],
};

describe("HealthBadge", () => {
  it("renders accessible text for health", () => {
    render(<HealthBadge health="unhealthy" />);
    expect(screen.getByText("Unhealthy")).toBeInTheDocument();
  });
});

describe("SystemTree", () => {
  it("renders hierarchy and notifies on selection", () => {
    const onSelect = vi.fn();
    render(
      <SystemTree
        system={snapshotSystem}
        selection={{ kind: "system", id: "system" }}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("Node A")).toBeInTheDocument();
    expect(screen.getByText("Device A")).toBeInTheDocument();
    expect(screen.getByText("no monitor")).toBeInTheDocument();
    expect(screen.getByText("NCP")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Rx 1"));
    expect(onSelect).toHaveBeenCalledWith({
      kind: "receiver",
      id: "receiver-1",
    });
  });

  it("shows NCP connected and transition totals only with monitoring context", () => {
    render(
      <SystemTree
        system={snapshotSystem}
        selection={{ kind: "system", id: "system" }}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("NCP")).toBeInTheDocument();
    expect(screen.getByTitle("NCP WebSocket connected")).toBeInTheDocument();
    // System / node / device / monitored sender show Σ; unmonitored receiver does not.
    expect(screen.getAllByText(/Σ /).length).toBe(4);
    expect(screen.getByText("no monitor")).toBeInTheDocument();
    expect(screen.getByLabelText("Video")).toBeInTheDocument();
    expect(screen.getByLabelText("Audio")).toBeInTheDocument();
  });
});

describe("ConnectionsView", () => {
  it("orbits receivers around their connected sender and lists disconnected", async () => {
    const { ConnectionsView } = await import("./ConnectionsView");
    const onSelect = vi.fn();
    render(
      <ConnectionsView
        connections={{
          hubs: [
            {
              sender: {
                kind: "sender",
                id: "sender-1",
                label: "Tx 1",
                health: "healthy",
                childCount: 0,
                totalTransitions: 1,
                meta: { hasMonitor: true, format: "video" },
              },
              receivers: [
                {
                  kind: "receiver",
                  id: "receiver-1",
                  label: "Rx connected",
                  health: "healthy",
                  childCount: 0,
                  totalTransitions: 0,
                  meta: { hasMonitor: true, format: "video" },
                },
              ],
            },
          ],
          disconnected: [
            {
              kind: "receiver",
              id: "receiver-2",
              label: "Rx free",
              health: "unknown",
              childCount: 0,
              totalTransitions: 0,
              meta: { hasMonitor: false, format: "audio" },
            },
          ],
        }}
        selection={{ kind: "system", id: "system" }}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("Tx 1")).toBeInTheDocument();
    expect(screen.getByText("Rx connected")).toBeInTheDocument();
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByText("Rx free")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Select Rx connected"));
    expect(onSelect).toHaveBeenCalledWith({
      kind: "receiver",
      id: "receiver-1",
    });
  });

  it("shows an empty state when there are no senders or receivers", async () => {
    const { ConnectionsView } = await import("./ConnectionsView");
    render(
      <ConnectionsView
        connections={{ hubs: [], disconnected: [] }}
        selection={{ kind: "system", id: "system" }}
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByText("No senders or receivers in the registry yet."),
    ).toBeInTheDocument();
  });
});

describe("ensureSnapshotConnections", () => {
  it("fills missing connections payloads", async () => {
    const { ensureSnapshotConnections } = await import("./useDashboardState");
    const normalized = ensureSnapshotConnections({
      generatedAt: 1,
      registry: { connected: false },
      system: {
        kind: "system",
        id: "system",
        label: "System",
        health: "unknown",
        childCount: 0,
        totalTransitions: 0,
        children: [],
      },
    });
    expect(normalized.connections).toEqual({ hubs: [], disconnected: [] });

    const intact = ensureSnapshotConnections({
      ...normalized,
      connections: {
        hubs: [
          {
            sender: {
              kind: "sender",
              id: "s1",
              label: "S",
              health: "healthy",
              childCount: 0,
              totalTransitions: 0,
            },
            receivers: [],
          },
        ],
        disconnected: [],
      },
    });
    expect(intact.connections?.hubs).toHaveLength(1);
  });
});

describe("ContributorsList", () => {
  it("renders contributors and handles clicks", () => {
    const onSelect = vi.fn();
    render(
      <ContributorsList
        title="Worst nodes"
        contributors={[
          {
            kind: "node",
            id: "node-1",
            label: "Bad Node",
            health: "unhealthy",
            message: "NIC down",
          },
        ]}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("NIC down")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Bad Node"));
    expect(onSelect).toHaveBeenCalledWith({ kind: "node", id: "node-1" });
  });
});

describe("DetailPanel", () => {
  it("renders system detail with contributors", () => {
    const detail: SelectionDetailDto = {
      kind: "system",
      id: "system",
      label: "System",
      health: "degraded",
      totalTransitions: 5,
      worstContributors: [
        {
          kind: "node",
          id: "node-1",
          label: "Node A",
          health: "degraded",
        },
      ],
    };

    render(
      <DetailPanel
        detail={detail}
        loading={false}
        error={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("System")).toBeInTheDocument();
    expect(
      screen.getByText("Worst nodes contributing to system state"),
    ).toBeInTheDocument();
  });

  it("renders sender detail without monitor", () => {
    const detail: SelectionDetailDto = {
      kind: "sender",
      id: "sender-1",
      label: "Tx 1",
      health: "unknown",
      acknowledged: false,
      deviceId: "device-1",
      resource: {
        id: "sender-1",
        version: "1:0",
        label: "Tx 1",
        description: "",
        device_id: "device-1",
        flow_id: null,
        transport: "urn:x-nmos:transport:rtp",
      },
    };

    render(
      <DetailPanel
        detail={detail}
        loading={false}
        error={null}
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByText("No sender monitor bound via touchpoints."),
    ).toBeInTheDocument();
  });

  it("renders receiver detail with connected sender link", () => {
    const onSelect = vi.fn();
    const detail: SelectionDetailDto = {
      kind: "receiver",
      id: "receiver-1",
      label: "Rx 1",
      health: "healthy",
      acknowledged: false,
      deviceId: "device-1",
      resource: {
        id: "receiver-1",
        version: "1:0",
        label: "Rx 1",
        description: "desc",
        device_id: "device-1",
        transport: "urn:x-nmos:transport:rtp",
        subscription: { sender_id: "sender-1", active: true },
      },
      connectedSender: {
        id: "sender-1",
        label: "Tx 1",
        deviceId: "device-1",
        health: "healthy",
      },
      monitor: {
        oid: 10,
        kind: "receiver",
        role: "ReceiverMonitor_01",
        overallStatus: 1,
        overallStatusMessage: "ok",
        health: "healthy",
        totalTransitions: 0,
        domains: [
          { name: "linkStatus", status: 1, message: "up", transitionCounter: 0 },
        ],
      },
    };

    render(
      <DetailPanel
        detail={detail}
        loading={false}
        error={null}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("Domain statuses")).toBeInTheDocument();
    expect(screen.getAllByText("Healthy (1)").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole("tab", { name: "IS-04" }));
    fireEvent.click(screen.getByText(/Tx 1/));
    expect(onSelect).toHaveBeenCalledWith({
      kind: "sender",
      id: "sender-1",
    });
  });

  it("reinitialises a device from the details pane", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, deviceId: "device-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const detail: SelectionDetailDto = {
      kind: "device",
      id: "device-1",
      label: "Device 1",
      health: "healthy",
      totalTransitions: 0,
      acknowledged: false,
      resource: {
        id: "device-1",
        version: "1:0",
        label: "Device 1",
        description: "",
        type: "urn:x-nmos:device:generic",
        node_id: "node-1",
        controls: [],
      },
      ncp: {
        availability: "available",
        connected: true,
        href: "ws://device/ncp",
      },
      worstContributors: [],
    };

    render(
      <DetailPanel
        detail={detail}
        loading={false}
        error={null}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reinitialise" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/devices/device-1/reinitialise",
        { method: "POST" },
      );
    });
    expect(
      await screen.findByText(
        "NCP session restarted. Monitors are being re-acquired.",
      ),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("reinitialises every child device from a node details pane", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        reinitialised: 2,
        skipped: 0,
        failures: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const detail: SelectionDetailDto = {
      kind: "node",
      id: "node-1",
      label: "Node A",
      health: "healthy",
      totalTransitions: 1,
      acknowledged: false,
      resource: {
        id: "node-1",
        version: "1:0",
        label: "Node A",
        description: "",
        href: "http://node/x-nmos/node/v1.3/",
      },
      worstContributors: [],
    };

    render(
      <DetailPanel
        detail={detail}
        loading={false}
        error={null}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reinitialise" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/nodes/node-1/reinitialise",
        { method: "POST" },
      );
    });
    expect(
      await screen.findByText("Restarted 2 device session(s)."),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("shows loading and error states", () => {
    const { rerender } = render(
      <DetailPanel detail={null} loading error={null} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("Loading details…")).toBeInTheDocument();

    rerender(
      <DetailPanel
        detail={null}
        loading={false}
        error="boom"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
});
