# syntax=docker/dockerfile:1

# Imagem do gateway. O contexto de build é o diretório do serviço (ADR 0001).
# Estágios: base -> deps -> dev (compose watch)
#                        -> build -> runtime (com prod-deps)

ARG NODE_VERSION=26.10.0

FROM node:${NODE_VERSION}-slim AS base
# Só o binário oficial do Node tem Temporal garantido (ADR 0003): a build falha sem ele.
RUN node -e "if (typeof Temporal === 'undefined') { console.error('Node sem Temporal'); process.exit(1) }"
WORKDIR /app
# O Node 26 não traz o Corepack: o pnpm é instalado na versão do packageManager (ADR 0004).
COPY package.json ./
RUN npm install -g --allow-scripts=pnpm "$(node -p "require('./package.json').packageManager")" \
    && pnpm --version

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store-gateway,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# Desenvolvimento: o compose sincroniza src/ e o tsx reinicia a cada mudança.
FROM deps AS dev
COPY . .
CMD ["pnpm", "dev"]

FROM deps AS build
COPY . .
RUN pnpm build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store-gateway,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm/store

FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
# Quando existir o src/main.ts, o comando passa a ser ["node", "dist/main.js", "<papel>"].
CMD ["node", "dist/server.js"]
