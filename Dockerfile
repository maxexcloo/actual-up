FROM node:26.10.0-bookworm-slim AS build

WORKDIR /workspace
RUN npm install --global pnpm@12.9.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY src ./src
COPY tsconfig.build.json tsconfig.json ./
RUN pnpm run build && pnpm prune --prod

FROM node:26.10.0-bookworm-slim AS runtime

ENV ACTUAL_UP_CONFIG=/config/config.yaml
ENV NODE_ENV=production

WORKDIR /app
COPY --from=build --chown=node:node /workspace/dist ./dist
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/package.json ./package.json

RUN mkdir -p /data/actual-cache && chown -R node:node /data

USER node
EXPOSE 3000
CMD ["node", "dist/cli.js", "bridge"]
