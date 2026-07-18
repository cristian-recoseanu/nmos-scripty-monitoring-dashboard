# NMOS Scripty Monitoring Dashboard

[![CI]([https://github.com/cristian-recoseanu/nmos-scripty-monitoring-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/cristian-recoseanu/nmos-scripty-monitoring-dashboard/actions/workflows/ci.yml)](https://github.com/cristian-recoseanu/nmos-scripty-monitoring-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/cristian-recoseanu/nmos-scripty-monitoring-dashboard/actions/workflows/ci.yml))

Next.js (App Router, SSR) monitoring application that harvests an IS-04 Query API registry and BCP-008 sender/receiver monitors via IS-12 / MS-05-02, then presents a traffic-light system view.

## Requirements

- Node.js 20+
- npm 10+

## Quick start

```bash
cp .env.example .env
# edit NMOS_REGISTRY_HOST / NMOS_REGISTRY_PORT

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Optional YAML config (env overrides file):

```bash
cp config.example.yaml config.yaml
```

## Scripts


| Script                        | Purpose                                |
| ----------------------------- | -------------------------------------- |
| `npm run dev`                 | Development server (Turbopack)         |
| `npm run build` / `npm start` | Production build and serve             |
| `npm run lint`                | ESLint                                 |
| `npm test`                    | Unit tests (Vitest)                    |
| `npm run test:coverage`       | Unit tests with **coverage gate** (CI) |


Coverage thresholds (enforced by Vitest): lines/functions/statements ≥ 80%, branches ≥ 75% for `src/config`, `src/server`, and `src/lib`.

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                     Browser (Dashboard)                      │
│  System tree + selection detail  ←── SSE /api/events         │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP
┌───────────────────────────▼─────────────────────────────────┐
│              Next.js App Router (single Node process)        │
│  /api/snapshot  /api/detail  /api/status  /api/monitors/*    │
│                                                              │
│  AppRuntime singleton                                        │
│    ├─ ResourceStore (IS-04 inventory)                        │
│    ├─ Is04Orchestrator ──WS grains──► Query API              │
│    ├─ NcpOrchestrator  ──IS-12/NCP──► per-device sessions    │
│    ├─ Health aggregator → SystemSnapshotDto                  │
│    └─ RuntimeEventBus (debounced SSE fan-out)                │
└─────────────────────────────────────────────────────────────┘
         │                                      │
         ▼                                      ▼
   IS-04 Query API                    Device NCP (IS-12)
   (registry)                         NcSender/ReceiverMonitor
```

- **Single Node process**: IS-04 Query WebSockets and IS-12 NCP sessions live in an in-memory process singleton (`getAppRuntime()`). Run one app instance (or sticky sessions). Multi-instance shared state is out of scope for now.
- Prefer non-persistent Query API subscriptions (`persist: false`); they are cleaned up when WebSockets close.
- Registry / NCP disconnects auto-retry with backoff; malformed grains and IS-12 messages are logged and skipped.
- Per-device NCP failures are isolated so the rest of the tree stays live.
- `/api/status` exposes registry connection state plus lightweight in-process metrics (resource counts, NCP sessions, reconnect counters).



## HTTP API


| Method | Path                                          | Purpose                                                                 |
| ------ | --------------------------------------------- | ----------------------------------------------------------------------- |
| `GET`  | `/api/status`                                 | Runtime / registry connection status + metrics                          |
| `GET`  | `/api/snapshot`                               | Full system tree with bubbled health                                    |
| `GET`  | `/api/detail?kind=&id=`                       | Selection detail (`system` | `node` | `device` | `sender` | `receiver`) |
| `GET`  | `/api/events`                                 | SSE stream of snapshot updates                                          |
| `POST` | `/api/system/reset-monitors`                  | `ResetCountersAndMessages` on all connected NCP monitors                |
| `POST` | `/api/monitors/:deviceId/:oid/reset`          | `ResetCountersAndMessages`                                              |
| `POST` | `/api/monitors/:deviceId/:oid/auto-reset`     | Body `{ "value": boolean }`                                             |
| `GET`  | `/api/monitors/:deviceId/:oid/counters?type=` | `lost` | `late` | `transmission`                                        |




## UI

Open `/` for the split dashboard:

- **Top:** Tabbed **System view** (org chart) and **Connections view** (sender hubs with orbiting receivers + Disconnected group).
- **Bottom:** Selection detail, worst contributors, and monitor actions (reset / auto-reset / counters).
- Header: system health, total transitions (green/amber), **Reset all**, registry / live connection pills.
- Live updates over SSE (`/api/events`). Swap views anytime via tabs (`?view=connections`).



## Configuration


| Variable                  | Description                                       |
| ------------------------- | ------------------------------------------------- |
| `NMOS_REGISTRY_HOST`      | Registry hostname or IP (required unless URL set) |
| `NMOS_REGISTRY_PORT`      | Registry port (required)                          |
| `NMOS_REGISTRY_URL`       | Optional full URL (`http://host:port/path`)       |
| `NMOS_REGISTRY_PROTOCOL`  | `http` or `https` (default `http`)                |
| `NMOS_QUERY_API_VERSION`  | e.g. `v1.3`                                       |
| `NMOS_QUERY_BASE_PATH`    | default `/x-nmos/query`                           |
| `NMOS_REGISTRY_SECURE_WS` | Query subscription `secure` flag                  |
| `NMOS_CONFIG_PATH`        | Path to YAML config file (default `config.yaml`)  |
| `LOG_LEVEL`               | `fatal` … `trace` / `silent`                      |
| `PORT`                    | App listen port (default 3000)                    |




## Specs

- [IS-04](https://specs.amwa.tv/is-04/)
- [IS-12](https://specs.amwa.tv/is-12/)
- [MS-05-02](https://specs.amwa.tv/ms-05-02/)
- [BCP-008-01](https://specs.amwa.tv/bcp-008-01/) / [BCP-008-02](https://specs.amwa.tv/bcp-008-02/)

