import { describe, expect, it } from "vitest";

import { classifyGrainEvent, parseGrainMessage } from "@/server/is04";

describe("classifyGrainEvent", () => {
  it("classifies added / removed / modified / sync", () => {
    expect(classifyGrainEvent({ path: "a", post: { id: "a" } })).toBe("added");
    expect(classifyGrainEvent({ path: "a", pre: { id: "a" } })).toBe("removed");
    expect(
      classifyGrainEvent({
        path: "a",
        pre: { id: "a", label: "old" },
        post: { id: "a", label: "new" },
      }),
    ).toBe("modified");
    expect(
      classifyGrainEvent({
        path: "a",
        pre: { id: "a", label: "same" },
        post: { id: "a", label: "same" },
      }),
    ).toBe("sync");
  });

  it("throws when neither pre nor post is present", () => {
    expect(() => classifyGrainEvent({ path: "a" })).toThrow(/pre and\/or post/);
  });
});

describe("parseGrainMessage", () => {
  it("parses a grain with multiple events", () => {
    const events = parseGrainMessage({
      grain: {
        topic: "/flows/",
        data: [
          {
            path: "flow-1",
            post: { id: "flow-1", label: "f1" },
          },
          {
            path: "flow-2",
            pre: { id: "flow-2" },
          },
        ],
      },
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: "added",
      resourceId: "flow-1",
      resourcePath: "/flows",
    });
    expect(events[1]).toMatchObject({
      kind: "removed",
      resourceId: "flow-2",
      resourcePath: "/flows",
    });
  });

  it("rejects malformed messages", () => {
    expect(() => parseGrainMessage(null)).toThrow();
    expect(() => parseGrainMessage({})).toThrow(/grain.data/);
  });
});
