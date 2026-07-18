"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { EntityKind } from "@/server/domain";
import type {
  ConnectionsSnapshotDto,
  SelectionDetailDto,
  SystemSnapshotDto,
} from "@/server/domain/snapshot";
import type { AppRuntimeStatus } from "@/server/runtime/app-runtime";

export type Selection = {
  kind: EntityKind;
  id: string;
};

export type DashboardView = "system" | "connections";

const VALID_KINDS = new Set<EntityKind>([
  "system",
  "node",
  "device",
  "sender",
  "receiver",
]);

const EMPTY_CONNECTIONS: ConnectionsSnapshotDto = {
  hubs: [],
  disconnected: [],
};

/** Guard against older/partial snapshots missing the connections payload. */
export function ensureSnapshotConnections(
  snapshot: SystemSnapshotDto,
): SystemSnapshotDto {
  if (snapshot.connections?.hubs && snapshot.connections.disconnected) {
    return snapshot;
  }
  return {
    ...snapshot,
    connections: snapshot.connections ?? EMPTY_CONNECTIONS,
  };
}

function parseSelection(
  kindParam: string | null,
  idParam: string | null,
): Selection {
  if (
    kindParam &&
    idParam &&
    VALID_KINDS.has(kindParam as EntityKind)
  ) {
    return { kind: kindParam as EntityKind, id: idParam };
  }
  return { kind: "system", id: "system" };
}

function parseView(viewParam: string | null): DashboardView {
  return viewParam === "connections" ? "connections" : "system";
}

export function useDashboardState(initialSnapshot: SystemSnapshotDto) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selection = useMemo(
    () => parseSelection(searchParams.get("kind"), searchParams.get("id")),
    [searchParams],
  );

  const view = useMemo(
    () => parseView(searchParams.get("view")),
    [searchParams],
  );

  const [snapshot, setSnapshot] = useState(() =>
    ensureSnapshotConnections(initialSnapshot),
  );
  const [detail, setDetail] = useState<SelectionDetailDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [status, setStatus] = useState<AppRuntimeStatus | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

  const setSelection = useCallback(
    (next: Selection) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("kind", next.kind);
      params.set("id", next.id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setView = useCallback(
    (next: DashboardView) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "system") {
        params.delete("view");
      } else {
        params.set("view", next);
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    const source = new EventSource("/api/events");

    source.addEventListener("snapshot", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          snapshot: SystemSnapshotDto;
        };
        setSnapshot(ensureSnapshotConnections(payload.snapshot));
        setSseConnected(true);
      } catch {
        // ignore malformed events
      }
    });

    source.addEventListener("open", () => setSseConnected(true));
    source.onerror = () => setSseConnected(false);

    return () => source.close();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail() {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const response = await fetch(
          `/api/detail?kind=${encodeURIComponent(selection.kind)}&id=${encodeURIComponent(selection.id)}`,
        );
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "Selected resource is no longer available"
              : `Failed to load detail (${response.status})`,
          );
        }
        const body = (await response.json()) as SelectionDetailDto;
        if (!cancelled) {
          setDetail(body);
        }
      } catch (error) {
        if (!cancelled) {
          setDetail(null);
          setDetailError(
            error instanceof Error ? error.message : "Failed to load detail",
          );
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selection.kind, selection.id, snapshot.generatedAt]);

  useEffect(() => {
    let cancelled = false;
    async function loadStatus() {
      try {
        const response = await fetch("/api/status");
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as AppRuntimeStatus;
        if (!cancelled) {
          setStatus(body);
        }
      } catch {
        // ignore
      }
    }
    void loadStatus();
    const timer = setInterval(() => void loadStatus(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [snapshot.generatedAt]);

  return {
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
  };
}
