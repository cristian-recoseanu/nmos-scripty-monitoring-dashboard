import {
  CLASS_ID_BLOCK,
  METHOD_FIND_MEMBERS_BY_CLASS_ID,
  PROP_MEMBERS,
  ROOT_BLOCK_OID,
  type Is12Session,
  type NcClassId,
  type NcOid,
} from "@/server/is12";

import {
  CLASS_ID_RECEIVER_MONITOR,
  CLASS_ID_SENDER_MONITOR,
  CLASS_ID_STATUS_MONITOR,
  detectMonitorKind,
  type MonitorKind,
} from "./class-ids";

export type BlockMemberDescriptor = {
  role: string;
  oid: NcOid;
  constantOid?: boolean;
  classId: NcClassId;
  userLabel?: string | null;
  owner?: NcOid;
  description?: string;
};

export type DiscoveredMonitor = {
  kind: MonitorKind;
  oid: NcOid;
  role: string;
  classId: NcClassId;
  userLabel?: string | null;
  description?: string;
};

function asMemberDescriptors(value: unknown): BlockMemberDescriptor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is BlockMemberDescriptor =>
      entry !== null &&
      typeof entry === "object" &&
      typeof (entry as BlockMemberDescriptor).oid === "number" &&
      Array.isArray((entry as BlockMemberDescriptor).classId),
  );
}

/**
 * Harvest NcReceiverMonitor / NcSenderMonitor objects from the device model.
 * Prefers FindMembersByClassId on the root block; falls back to recursive members walk.
 */
export async function harvestMonitors(
  session: Is12Session,
): Promise<DiscoveredMonitor[]> {
  try {
    const byClass = await findMonitorsByClassId(session);
    if (byClass.length > 0) {
      return byClass;
    }
  } catch {
    // Fall through to recursive walk.
  }

  return walkMembersForMonitors(session, ROOT_BLOCK_OID);
}

async function findMonitorsByClassId(
  session: Is12Session,
): Promise<DiscoveredMonitor[]> {
  // Search for all status monitors including derived sender/receiver classes.
  const result = await session.invoke(
    ROOT_BLOCK_OID,
    METHOD_FIND_MEMBERS_BY_CLASS_ID,
    {
      classId: CLASS_ID_STATUS_MONITOR,
      includeDerived: true,
      recurse: true,
    },
  );

  const members = asMemberDescriptors(result.value);
  const discovered: DiscoveredMonitor[] = [];
  for (const member of members) {
    const kind = detectMonitorKind(member.classId);
    if (!kind) {
      continue;
    }
    discovered.push({
      kind,
      oid: member.oid,
      role: member.role,
      classId: member.classId,
      userLabel: member.userLabel,
      description: member.description,
    });
  }
  return discovered;
}

async function walkMembersForMonitors(
  session: Is12Session,
  blockOid: NcOid,
  seen = new Set<NcOid>(),
): Promise<DiscoveredMonitor[]> {
  if (seen.has(blockOid)) {
    return [];
  }
  seen.add(blockOid);

  const value = await session.getProperty(blockOid, PROP_MEMBERS);
  const members = asMemberDescriptors(value);
  const found: DiscoveredMonitor[] = [];

  for (const member of members) {
    const kind = detectMonitorKind(member.classId);
    if (kind) {
      found.push({
        kind,
        oid: member.oid,
        role: member.role,
        classId: member.classId,
        userLabel: member.userLabel,
        description: member.description,
      });
    }

    if (
      member.classId.length >= CLASS_ID_BLOCK.length &&
      CLASS_ID_BLOCK.every((part, index) => member.classId[index] === part) &&
      member.classId.length === CLASS_ID_BLOCK.length
    ) {
      const nested = await walkMembersForMonitors(session, member.oid, seen);
      found.push(...nested);
    }
  }

  return found;
}

export function isReceiverMonitorClass(classId: NcClassId): boolean {
  return detectMonitorKind(classId) === "receiver";
}

export function isSenderMonitorClass(classId: NcClassId): boolean {
  return detectMonitorKind(classId) === "sender";
}

export {
  CLASS_ID_RECEIVER_MONITOR,
  CLASS_ID_SENDER_MONITOR,
  CLASS_ID_STATUS_MONITOR,
};
