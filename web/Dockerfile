# Frontend (Next.js). A Node base image guarantees node/npm exist regardless of
# how the platform classifies the service — the "npm: not found" build failure
# was a non-Node build environment.
FROM node:20-slim

WORKDIR /app

# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time, so they must be
# present now (not just at runtime). Render exposes the service's env vars to the
# Docker build as build args; we also DEFAULT the API base to the production URL
# so the image is correct even if the build arg isn't passed. Override by setting
# NEXT_PUBLIC_API_BASE on the service (and redeploy with cache cleared).
ARG NEXT_PUBLIC_DATA_SOURCE=api
ARG NEXT_PUBLIC_API_BASE=https://api.haydari.org/api
ENV NEXT_PUBLIC_DATA_SOURCE=$NEXT_PUBLIC_DATA_SOURCE \
    NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# Install deps first (layer cache) — needs package.json + lockfile.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000
# `next start` binds to $PORT, which Render provides.
CMD ["npm", "start"]
