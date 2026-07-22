/** Trailing-slash-safe path builders for the IS-05 Connection API (single). */

export function senderActivePath(senderId: string): string {
  return `single/senders/${senderId}/active`;
}

export function senderTransportFilePath(senderId: string): string {
  return `single/senders/${senderId}/transportfile`;
}

export function receiverActivePath(receiverId: string): string {
  return `single/receivers/${receiverId}/active`;
}
