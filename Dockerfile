# syntax=docker/dockerfile:1

# SPLASH C2 — container image
#
# Three stages so the image that ships holds no package manager, no sources and
# no dev dependencies: install, build, run. The runner copies Next's standalone
# bundle, which carries its own server and only the modules the build traced.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app


# Dependencies, cached on the lockfile alone: editing a component does not
# reinstall the tree.
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile


FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are baked into the client bundle at build time, so the
# Mapbox token has to arrive here rather than at boot. Railway passes service
# variables to the build as args, but only ones the Dockerfile declares. With
# no token the console still builds and runs; the chart falls back.
ARG NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=""
ENV NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=$NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
ENV NODE_ENV=production
RUN pnpm build


FROM node:24-alpine AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Railway injects PORT; this is the fallback for a plain `docker run`.
ENV PORT=3000
# Binding to localhost would make the container unreachable from the proxy.
ENV HOSTNAME=0.0.0.0
WORKDIR /app

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets sit outside the standalone trace and have to be copied beside
# it, or every hashed chunk and font 404s.
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
