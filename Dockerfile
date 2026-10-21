# syntax=docker/dockerfile:1

# The full build image supplies Python and a compiler for SQLite native bindings.
FROM node:26.12.0-trixie AS build

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci

COPY assets ./assets
COPY src ./src
COPY tsconfig.build.json tsconfig.json ./
RUN npm run build && npm prune --omit=dev

FROM node:26.12.0-trixie-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --chown=node:node --from=build /workspace/dist ./dist
COPY --chown=node:node --from=build /workspace/node_modules ./node_modules
COPY --chown=node:node --from=build /workspace/package.json ./package.json

# Apply Debian fixes not yet included in the Node image. The runtime
# only executes Node; package managers and their dependencies are unnecessary.
# Slim images lack OpenSSL's default CA path, so apt is pointed at the copied bundle.
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && echo 'Acquire::https::CaInfo "/etc/ssl/certs/ca-certificates.crt";' > /etc/apt/apt.conf.d/99ca-certificates \
    && apt-get update --error-on=any \
    && apt-get upgrade --no-install-recommends -y \
    && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /opt/yarn* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir -p /data/actual-cache \
    && chown -R node:node /data

USER node
EXPOSE 3000
CMD ["node", "dist/cli.js", "serve"]
