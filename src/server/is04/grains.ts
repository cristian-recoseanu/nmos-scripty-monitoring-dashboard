import type { ResourcePath, Uuid } from "./types";

/**
 * IS-04 Query API WebSocket data grain (event) shapes.
 * @see https://specs.amwa.tv/is-04/releases/v1.3.3/docs/Behaviour_-_Querying.html
 */

export type GrainEventKind = "added" | "removed" | "modified" | "sync";

export type GrainDataEvent<T = Record<string, unknown>> = {
  path: Uuid;
  pre?: T;
  post?: T;
};

export type QueryGrainMessage<T = Record<string, unknown>> = {
  grain_type?: string;
  source_id?: string;
  flow_id?: string;
  grain: {
    type?: string;
    topic: string;
    data: GrainDataEvent<T>[];
  };
};

export type ParsedGrainEvent<T = Record<string, unknown>> = {
  kind: GrainEventKind;
  resourceId: Uuid;
  topic: string;
  resourcePath: ResourcePath | null;
  pre?: T;
  post?: T;
};

function topicToResourcePath(topic: string): ResourcePath | null {
  const normalised = topic.endsWith("/") ? topic.slice(0, -1) : topic;
  const allowed: ResourcePath[] = [
    "/nodes",
    "/devices",
    "/senders",
    "/receivers",
    "/flows",
    "/sources",
  ];
  return allowed.includes(normalised as ResourcePath)
    ? (normalised as ResourcePath)
    : null;
}

export function classifyGrainEvent<T>(
  event: GrainDataEvent<T>,
): GrainEventKind {
  const hasPre = event.pre !== undefined;
  const hasPost = event.post !== undefined;

  if (hasPost && !hasPre) {
    return "added";
  }
  if (hasPre && !hasPost) {
    return "removed";
  }
  if (hasPre && hasPost) {
    // Sync grains use identical pre/post; modifications differ.
    try {
      if (JSON.stringify(event.pre) === JSON.stringify(event.post)) {
        return "sync";
      }
    } catch {
      // Fall through to modified if values are not serialisable.
    }
    return "modified";
  }

  throw new Error("Grain event must include pre and/or post");
}

export function parseGrainMessage<T = Record<string, unknown>>(
  raw: unknown,
): ParsedGrainEvent<T>[] {
  if (raw === null || typeof raw !== "object") {
    throw new Error("Grain message must be an object");
  }

  const message = raw as QueryGrainMessage<T>;
  if (!message.grain || !Array.isArray(message.grain.data)) {
    throw new Error("Grain message missing grain.data array");
  }

  const topic = message.grain.topic ?? "";
  const resourcePath = topicToResourcePath(topic);

  return message.grain.data.map((event) => {
    const kind = classifyGrainEvent(event);
    return {
      kind,
      resourceId: event.path,
      topic,
      resourcePath,
      pre: event.pre,
      post: event.post,
    };
  });
}
