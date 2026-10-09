FROM node:26.11.1-bookworm-slim AS build

WORKDIR /workspace
RUN npm install --global pnpm@12.10.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY assets ./assets
COPY src ./src
COPY tsconfig.build.json tsconfig.json ./
RUN pnpm run build && pnpm prune --prod

FROM node:26.11.1-bookworm-slim AS runtime

ENV ACTUAL_UP_CONFIG=/config/config.yaml
ENV NODE_ENV=production

WORKDIR /app
COPY --from=build --chown=node:node /workspace/dist ./dist
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/package.json ./package.json

# Apply Debian fixes not yet included in the pinned Node image. The runtime
# only executes Node; package managers and their dependencies are unnecessary.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /opt/yarn* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir -p /data/actual-cache \
    && chown -R node:node /data

USER node
EXPOSE 3000
CMD ["node", "dist/cli.js", "serve"]
