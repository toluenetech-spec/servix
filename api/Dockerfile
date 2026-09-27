# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build stage
# Installs all dependencies, generates Prisma Client, compiles TypeScript,
# then drops development dependencies so only runtime packages are copied on.
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

# prisma/schema.prisma generates into ../src/generated/prisma, which tsc then
# compiles to dist/generated/prisma (see the import in src/lib/db.ts). Any
# non-TypeScript asset the generator emits is copied next to its compiled
# output so the runtime image never depends on files left behind by the build.
RUN npx prisma generate \
 && npm run build \
 && mkdir -p dist/generated \
 && cp -R src/generated/. dist/generated/ \
 && find dist/generated -name '*.ts' -delete \
 && npm prune --omit=dev

# -------------------------------------------------------------- runtime stage
# blitz.cloud starts containers as UID/GID 1000 with all Linux capabilities
# dropped. The official Node image already ships a `node` user at UID 1000, so
# no user needs to be created and nothing is installed at runtime.
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 8080
STOPSIGNAL SIGTERM

# Liveness only: this checks that the process answers. Database, queue and
# storage readiness remain available at /readyz for operational checks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
