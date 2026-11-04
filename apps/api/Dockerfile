# The Season Challenger API. Build it from the repository root:
#   docker build -f apps/api/Dockerfile -t season-api .
# docs/RELEASE.md says how to run it and what has and has not been tested.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN npm install --global pnpm@10.28.0
COPY . .
RUN pnpm install --frozen-lockfile --filter "@season/api..."
RUN pnpm --filter @season/api build
# Copies dist/, drizzle/ and the production dependencies, and nothing else, into /prod/api.
RUN pnpm --filter @season/api deploy --prod --legacy /prod/api

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /prod/api ./
USER node
EXPOSE 3000
# Migrate with: docker run ... season-api node dist/migrate.js
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/main.js"]
