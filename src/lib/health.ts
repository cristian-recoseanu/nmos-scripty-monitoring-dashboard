/**
 * Shared health severity model for traffic-light aggregation.
 *
 * Leaf display may use all severities. Parent bubbling ignores `unknown` and
 * `inactive` (see `aggregateParentHealth`).
 */

export const HEALTH_SEVERITIES = [
  "unhealthy",
  "degraded",
  "unknown",
  "healthy",
  "inactive",
] as const;

export type HealthSeverity = (typeof HEALTH_SEVERITIES)[number];

const SEVERITY_RANK: Record<HealthSeverity, number> = {
  unhealthy: 0,
  degraded: 1,
  unknown: 2,
  healthy: 3,
  inactive: 4,
};

/** Severities that do not contribute to parent health when bubbling. */
export function isNeutralSeverity(severity: HealthSeverity): boolean {
  return severity === "unknown" || severity === "inactive";
}

/** Map BCP-008 / NcOverallStatus-style values onto app severities. */
export function mapOverallStatus(status: string | number | null | undefined): HealthSeverity {
  if (status == null || status === "") {
    return "unknown";
  }

  if (typeof status === "number") {
    switch (status) {
      case 0:
        return "inactive";
      case 1:
        return "healthy";
      case 2:
        return "degraded";
      case 3:
        return "unhealthy";
      default:
        return "unknown";
    }
  }

  switch (status) {
    case "Healthy":
      return "healthy";
    case "PartiallyHealthy":
      return "degraded";
    case "Unhealthy":
      return "unhealthy";
    case "Inactive":
    case "NotUsed":
      return "inactive";
    default:
      return "unknown";
  }
}

export function worstSeverity(
  severities: readonly HealthSeverity[],
): HealthSeverity {
  if (severities.length === 0) {
    return "unknown";
  }

  return severities.reduce((worst, current) =>
    SEVERITY_RANK[current] < SEVERITY_RANK[worst] ? current : worst,
  );
}

/**
 * Parent health from children: ignore `unknown` / `inactive`.
 * If every child is neutral (or the list is empty), result is `unknown`.
 */
export function aggregateParentHealth(
  severities: readonly HealthSeverity[],
): HealthSeverity {
  const counted = severities.filter((severity) => !isNeutralSeverity(severity));
  if (counted.length === 0) {
    return "unknown";
  }
  return worstSeverity(counted);
}

export function compareSeverity(a: HealthSeverity, b: HealthSeverity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

const NC_STATUS_BY_VALUE: Record<number, string> = {
  0: "Inactive",
  1: "Healthy",
  2: "PartiallyHealthy",
  3: "Unhealthy",
};

const NC_STATUS_BY_NAME: Record<string, number> = {
  Inactive: 0,
  NotUsed: 0,
  Healthy: 1,
  PartiallyHealthy: 2,
  Unhealthy: 3,
};

/**
 * Format an NcOverallStatus-style value for UI as `Label (n)` when both are known.
 */
export function formatNcStatus(
  status: number | string | null | undefined,
): string {
  if (status == null || status === "") {
    return "—";
  }

  if (typeof status === "number") {
    const label = NC_STATUS_BY_VALUE[status];
    return label ? `${label} (${status})` : String(status);
  }

  const numeric = NC_STATUS_BY_NAME[status];
  return numeric !== undefined ? `${status} (${numeric})` : status;
}
