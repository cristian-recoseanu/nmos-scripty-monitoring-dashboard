import { ConfigError, loadConfig } from "@/config";
import { getAppRuntime } from "@/server/runtime/app-runtime";
import { Dashboard } from "@/components/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  let configError: string | null = null;

  try {
    loadConfig();
  } catch (error) {
    configError =
      error instanceof ConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown configuration error";
  }

  const runtime = getAppRuntime();
  await runtime.ensureStarted();

  return (
    <Dashboard
      initialSnapshot={runtime.getSnapshot()}
      initialStatus={runtime.getStatus()}
      configError={configError}
    />
  );
}
