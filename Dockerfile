# One image for both the live server and the web app (docker-compose.yml runs each with its own command).
# Runtime is tsx (no build step for the server); the web app is built here with `next build`.

FROM node:22-bookworm-slim AS build
# better-sqlite3 downloads a prebuilt binary; the compilers are the fallback when there isn't one.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# The web app proxies /api to the live server; the address is compiled into the build (next.config.ts).
ARG API_URL=http://server:8787
ENV API_URL=$API_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @ab/web build

FROM node:22-bookworm-slim
RUN corepack enable
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /app /app
EXPOSE 8787 3000
