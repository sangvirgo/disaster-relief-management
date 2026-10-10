FROM node:24.15.0-bookworm-slim AS build
WORKDIR /workspace
COPY backend/package.json backend/package-lock.json ./backend/
COPY backend/apps ./backend/apps
COPY backend/packages ./backend/packages
COPY backend/scripts ./backend/scripts
COPY backend/nest-cli.json backend/tsconfig.json backend/tsconfig.test.json backend/jest.config.cjs ./backend/
COPY docs/backend/schema ./backend/schema
COPY docs/backend/seed ./backend/seed
WORKDIR /workspace/backend
RUN npm ci --no-audit --no-fund && npm run build && npm prune --omit=dev

FROM node:24.15.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace/backend
COPY --from=build --chown=node:node /workspace/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/backend/package.json ./package.json
COPY --from=build --chown=node:node /workspace/backend/apps ./apps
COPY --from=build --chown=node:node /workspace/backend/packages ./packages
COPY --from=build --chown=node:node /workspace/backend/dist ./dist
COPY --from=build --chown=node:node /workspace/backend/schema ./schema
COPY --from=build --chown=node:node /workspace/backend/seed ./seed
COPY --from=build --chown=node:node /workspace/backend/scripts ./scripts
USER node
CMD ["node", "dist/apps/logistics/src/main.js"]
