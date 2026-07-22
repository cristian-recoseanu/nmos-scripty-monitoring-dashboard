/**
 * Subset of IS-05 Connection API response types used for read-only harvest.
 * Schemas: https://github.com/AMWA-TV/is-05/tree/v1.1.x/APIs/schemas
 */

export type Is05Activation = {
  mode?: string | null;
  requested_time?: string | null;
  activation_time?: string | null;
};

export type Is05TransportFile = {
  data: string | null;
  type: string | null;
};

export type Is05SenderActive = {
  receiver_id: string | null;
  master_enable: boolean;
  activation: Is05Activation;
  transport_params: Array<Record<string, unknown>>;
};

export type Is05ReceiverActive = {
  sender_id: string | null;
  master_enable: boolean;
  activation: Is05Activation;
  transport_file: Is05TransportFile;
  transport_params: Array<Record<string, unknown>>;
};

export type Is05TransportFileView = {
  contentType: string;
  data: string;
};

export type Is05EntryStatus =
  | "pending"
  | "available"
  | "unavailable"
  | "skipped"
  | "error";

export type Is05CacheEntry = {
  resourceType: "sender" | "receiver";
  resourceId: string;
  deviceId: string;
  status: Is05EntryStatus;
  connectionApiHref?: string;
  /** Raw /active JSON (sender or receiver). */
  active?: Is05SenderActive | Is05ReceiverActive;
  transportFile?: Is05TransportFileView | null;
  fetchedAt?: number;
  sourceIs04Version?: string;
  error?: string;
};

/** Detail-panel DTO derived from {@link Is05CacheEntry}. */
export type Is05DetailDto = {
  status: Is05EntryStatus;
  connectionApiHref?: string;
  active?: Is05SenderActive | Is05ReceiverActive;
  transportFile?: Is05TransportFileView | null;
  fetchedAt?: number;
  sourceIs04Version?: string;
  error?: string;
};

export function toIs05DetailDto(entry: Is05CacheEntry): Is05DetailDto {
  return {
    status: entry.status,
    connectionApiHref: entry.connectionApiHref,
    active: entry.active,
    transportFile: entry.transportFile,
    fetchedAt: entry.fetchedAt,
    sourceIs04Version: entry.sourceIs04Version,
    error: entry.error,
  };
}

export function transportFileFromReceiverActive(
  active: Is05ReceiverActive,
): Is05TransportFileView | null {
  const file = active.transport_file;
  if (!file?.data || !file.type) {
    return null;
  }
  return { contentType: file.type, data: file.data };
}
