# syntax=docker/dockerfile:1
#
# The Docker deliverable of D-24/D-25: the Homematic Manager server (`apps/web`) - the backend of
# `packages/backend` behind an HTTP/WebSocket host that serves the built UI - as one image on
# ghcr.io/hobbyquaker/homematic-manager, for linux/amd64, linux/arm64 and linux/arm/v7.
#
# Two stages. The first builds the workspace and packs `apps/web` into exactly the tarball that
# `release-npm.yml` publishes, so the image and the npm package of one version contain the same
# program. The second installs that tarball globally into a plain `node:22-alpine`.
#
# The build stage is pinned to `$BUILDPLATFORM`, so it runs natively even when the image being
# produced is arm64 or arm/v7: everything in the tarball is JavaScript, and cross-compiling nothing
# is much faster than running tsc and vite under qemu. Only the small `npm install -g` of the
# runtime stage is emulated.
#
# See docs/install-docker.md for `--network host` versus published callback ports.

ARG NODE_VERSION=22

# ---------------------------------------------------------------------------------------------
# Build: the whole workspace, then `npm pack -w apps/web`
# ---------------------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS build

# `npm ci` installs the dev dependencies of every workspace, apps/electron's included. Its ~150 MB
# Chromium is of no use to a server image and nothing here builds the Electron app.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    CI=true

WORKDIR /src

# The whole context in one layer: the alternative - copying every workspace `package.json` first
# for a cacheable `npm ci` - silently breaks the moment a workspace is added, and this build runs
# on a cold CI runner anyway. `.dockerignore` keeps the context to what is actually needed.
COPY . .

RUN npm ci --no-audit --no-fund

# Only what the server needs, in dependency order. `apps/electron`'s `electron-vite build` is not
# part of this image, and `data`'s `dist/` is committed rather than built.
RUN npm run build -w @homematic-manager/core \
    -w @homematic-manager/backend \
    -w @homematic-manager/ui \
    -w @homematic-manager/web

# `prepack.mjs` copies the built UI and `data/dist` into the package and materialises the two
# bundled workspace packages; `postpack.mjs` undoes it. What comes out is self-contained.
RUN mkdir /pack && npm pack -w apps/web --pack-destination /pack

# ---------------------------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime

LABEL org.opencontainers.image.title="Homematic Manager" \
    org.opencontainers.image.description="Configure and administer Homematic and HomematicIP devices: devices and channels, direct links, paramsets, RSSI, service messages, events and an RPC console" \
    org.opencontainers.image.url="https://github.com/hobbyquaker/homematic-manager" \
    org.opencontainers.image.source="https://github.com/hobbyquaker/homematic-manager" \
    org.opencontainers.image.documentation="https://github.com/hobbyquaker/homematic-manager/blob/master/docs/install-docker.md" \
    org.opencontainers.image.vendor="Sebastian 'hobbyquaker' Raff" \
    org.opencontainers.image.licenses="AGPL-3.0-or-later"

# Every one of these mirrors a CLI option and can be overridden with `-e` or `environment:`.
#
# `HMM_HOST=0.0.0.0` because a container's loopback is nobody's: the port a user publishes has to
# be bound inside. `HMM_ISSUE_COOKIE` follows from that - the host hands the API token to the
# browser as a cookie only on a loopback bind, so without this the UI would load and its WebSocket
# would be refused with a 401. Anyone who can reach the published port therefore gets in; put a
# reverse proxy with `auth.require` in front (docs/lighttpd-homematic-manager.conf) and set
# `HMM_ISSUE_COOKIE=false` where that is not acceptable.
#
# The callback ports are pinned because a port the backend picks freely is a port no one can
# publish. hm2mqtt.js uses the same pair, so change one of them when both run with host networking.
ENV NODE_ENV=production \
    HMM_HOST=0.0.0.0 \
    HMM_PORT=8090 \
    HMM_DATA_DIR=/data \
    HMM_ISSUE_COOKIE=true \
    HMM_CALLBACK_XMLRPC_PORT=2126 \
    HMM_CALLBACK_BINRPC_PORT=2127

# The tarball is mounted rather than copied, so it leaves no layer behind. The package bundles
# `@homematic-manager/{backend,core}`; npm pulls its four registry dependencies (binrpc,
# homematic-rega, homematic-xmlrpc, ws), all of them pure JavaScript.
RUN --mount=from=build,source=/pack,target=/pack \
    npm install -g /pack/homematic-manager-web-*.tgz \
    && npm cache clean --force

# `config.json`, the per-CCU caches, the device-image cache and the write log.
RUN mkdir -p /data && chown node:node /data
VOLUME /data

# 8090 is the UI and the API socket. 2126/2127 are the callback ports the interface processes push
# events to - they only need publishing when the container is not on the host network, and then
# HMM_CALLBACK_IP must name the address the CCU reaches this host on (docs/install-docker.md).
EXPOSE 8090/tcp 2126/tcp 2127/tcp

USER node
WORKDIR /data

# Not `node dist/cli.js`: the global bin is what a user runs outside a container too, and it makes
# `docker run --rm <image> --version` and `--help` work as they read.
ENTRYPOINT ["homematic-manager-web"]
