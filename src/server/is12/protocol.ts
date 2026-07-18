/**
 * IS-12 message types and MS-05 element identifiers used by the controller.
 * @see https://specs.amwa.tv/is-12/releases/v1.0.1/docs/Protocol_messaging.html
 */

export enum MessageType {
  Command = 0,
  CommandResponse = 1,
  Notification = 2,
  Subscription = 3,
  SubscriptionResponse = 4,
  Error = 5,
}

export type NcElementId = {
  level: number;
  index: number;
};

export type NcClassId = number[];

export type NcOid = number;

/** NcObject methods */
export const METHOD_GET: NcElementId = { level: 1, index: 1 };
export const METHOD_SET: NcElementId = { level: 1, index: 2 };

/** NcObject properties */
export const PROP_TOUCHPOINTS: NcElementId = { level: 1, index: 7 };

/** NcBlock properties / methods */
export const PROP_MEMBERS: NcElementId = { level: 2, index: 2 };
export const METHOD_FIND_MEMBERS_BY_CLASS_ID: NcElementId = {
  level: 2,
  index: 4,
};

export const ROOT_BLOCK_OID: NcOid = 1;

/** NcBlock class id — used when walking members recursively. */
export const CLASS_ID_BLOCK: NcClassId = [1, 1];

export type Is12Command = {
  handle: number;
  oid: NcOid;
  methodId: NcElementId;
  arguments?: Record<string, unknown>;
};

export type Is12CommandMessage = {
  messageType: MessageType.Command;
  commands: Is12Command[];
};

export type Is12MethodResult = {
  status: number;
  value?: unknown;
  errorMessage?: string;
};

export type Is12CommandResponse = {
  handle: number;
  result: Is12MethodResult;
};

export type Is12CommandResponseMessage = {
  messageType: MessageType.CommandResponse;
  responses: Is12CommandResponse[];
};

export type Is12SubscriptionMessage = {
  messageType: MessageType.Subscription;
  subscriptions: NcOid[];
};

export type Is12SubscriptionResponseMessage = {
  messageType: MessageType.SubscriptionResponse;
  subscriptions: NcOid[];
};

export type Is12PropertyChangedEventData = {
  propertyId: NcElementId;
  changeType?: number;
  value?: unknown;
  sequenceItemIndex?: number | null;
};

export type Is12Notification = {
  oid: NcOid;
  eventId: NcElementId;
  eventData: Is12PropertyChangedEventData;
};

export type Is12NotificationMessage = {
  messageType: MessageType.Notification;
  notifications: Is12Notification[];
};

export type Is12ErrorMessage = {
  messageType: MessageType.Error;
  status: number;
  errorMessage: string;
};

export type Is12IncomingMessage =
  | Is12CommandResponseMessage
  | Is12NotificationMessage
  | Is12SubscriptionResponseMessage
  | Is12ErrorMessage
  | { messageType: number; [key: string]: unknown };

export function elementIdKey(id: NcElementId): string {
  return `${id.level}p${id.index}`;
}

export function elementIdsEqual(a: NcElementId, b: NcElementId): boolean {
  return a.level === b.level && a.index === b.index;
}

export function isMethodStatusOk(status: number): boolean {
  return status >= 200 && status < 300;
}
