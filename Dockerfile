FROM node:24-bookworm-slim AS build

ENV COREPACK_HOME=/tmp/corepack
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN corepack enable \
  && corepack prepare pnpm@11.7.0 --activate

WORKDIR /workspace
COPY . .

# The contract, web, and landing packages are not part of the API runtime.
# They remain in the build context only because pnpm resolves the workspace
# lockfile as one unit; the filtered build below compiles the API closure.
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm --filter @covenant/api... build \
  && pnpm deploy --filter @covenant/api --prod --legacy /out \
  && rm -rf /out/src /out/test /out/*.ts /out/vitest.config.ts \
    /out/.env.example /out/openapi.json /out/tsconfig*.json

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV COVENANT_API_HOST=0.0.0.0
ENV COVENANT_API_PORT=8787

WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
COPY --from=build --chown=node:node /workspace/deployment/arc-testnet/cov010-api-authorization-spec.json /app/deployment/arc-testnet/cov010-api-authorization-spec.json
COPY --from=build --chown=node:node /workspace/deployment/arc-testnet/executor-worker-routes.json /app/deployment/arc-testnet/executor-worker-routes.json

# Mount a persistent volume here for SQLite. The compiled PostgreSQL deployment
# entrypoint and authorization resolver are included under dist/deployment. The
# reviewed public COV-010 resolver artifact is copied above; alternate resolver
# data and adapter modules remain deployment-owned. Startup fails closed when
# required configuration is absent.
RUN mkdir -p /var/lib/covenant \
  && chown node:node /var/lib/covenant

USER node
EXPOSE 8787
STOPSIGNAL SIGTERM
CMD ["node", "dist/main.js"]
