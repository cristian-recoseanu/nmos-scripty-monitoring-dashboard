import { getAppRuntime } from "@/server/runtime/app-runtime";
import type { RuntimeEvent } from "@/server/domain/event-bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function encodeSse(event: RuntimeEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function GET(request: Request) {
  const app = getAppRuntime();
  await app.ensureStarted();
  const bus = app.getEventBus();

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let unsubscribe: () => void = () => undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        if (heartbeat !== undefined) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const send = (event: RuntimeEvent) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(encodeSse(event)));
        } catch {
          // Client gone / stream errored — drop this subscriber so emit
          // continues for everyone else.
          close();
        }
      };

      // Initial snapshot
      send({ type: "snapshot", snapshot: app.getSnapshot() });

      unsubscribe = bus.subscribe(send);
      heartbeat = setInterval(() => {
        send({ type: "heartbeat", at: Date.now() });
      }, 15_000);

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
