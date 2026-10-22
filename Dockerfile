# Ubuntu runtime with Node.js 24 (package engines require >=24).
# NodeSource supplies current 24.x builds for both linux/amd64 and linux/arm64.

FROM ubuntu:24.04 AS base

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

FROM base AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# next build loads instrumentation; give it a placeholder registry.
# Runtime configuration comes from env or a mounted config.yaml, not these values.
ENV NEXT_TELEMETRY_DISABLED=1 \
    NMOS_REGISTRY_HOST=127.0.0.1 \
    NMOS_REGISTRY_PORT=3211

RUN npm run build \
  && npm prune --omit=dev

FROM base AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nmos \
  && useradd --system --uid 1001 --gid nmos --home-dir /app --shell /usr/sbin/nologin nmos

COPY --from=build --chown=nmos:nmos /app /app

# WORKDIR creates /app as root. The log directory must be writable by nmos.
RUN mkdir -p /app/logs && chown nmos:nmos /app /app/logs

USER nmos

EXPOSE 3000

# Registry is required at runtime, via env and/or a mounted config file:
#   -e NMOS_REGISTRY_HOST=query.example -e NMOS_REGISTRY_PORT=80
#   -v /path/to/config.yaml:/app/config.yaml:ro
CMD ["node", "scripts/start.mjs"]
