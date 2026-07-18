export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { getAppRuntime } = await import("@/server/runtime/app-runtime");
  const { getRootLogger } = await import("@/server/logging");

  // Fire-and-forget: UI/API routes also call ensureStarted().
  void getAppRuntime()
    .ensureStarted()
    .catch((error: unknown) => {
      getRootLogger().error({ err: error }, "Runtime bootstrap failed");
    });
}
