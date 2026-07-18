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
      const send = (event: RuntimeEvent) => {
        controller.enqueue(encoder.encode(encodeSse(event)));
      };

      // Initial snapshot
      send({ type: "snapshot", snapshot: app.getSnapshot() });

      const unsubscribe = bus.subscribe(send);
      const heartbeat = setInterval(() => {
        send({ type: "heartbeat", at: Date.now() });
      }, 15_000);

      const close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

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
