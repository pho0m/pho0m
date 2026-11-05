# syntax=docker/dockerfile:1
#
# Admin API image for Cloud Run. Build from the REPO ROOT (it needs packages/content and
# content/seed.json, which get bundled into dist/server.js):
#
#   docker build -f api/Dockerfile -t pho0m-api .
#   docker run --rm -p 8080:8080 -e ADMIN_PASSWORD=change-me pho0m-api
#
# The runtime stage holds only the esbuild bundle: no node_modules, no sources.

FROM node:22-slim AS build
WORKDIR /app

# Manifests first so the dependency layer is cached. Only the workspaces the API needs are
# copied; npm ci is fine with the other workspace folders (web, tools/readme) being absent.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/content/package.json packages/content/tsconfig.json packages/content/
COPY api/package.json api/tsconfig.json api/
RUN npm ci --workspace=api --workspace=packages/content --no-audit --no-fund

COPY packages/content/src packages/content/src
COPY content/seed.json content/seed.json
COPY api/src api/src
RUN npm run build -w api && node --check api/dist/server.js


FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    NODE_OPTIONS=--disable-warning=DEP0040
WORKDIR /app

COPY --from=build --chown=node:node /app/api/dist ./dist
# Writable folder for the local driver (only used when no bucket is configured).
RUN mkdir -p /app/.data && chown node:node /app/.data

USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
