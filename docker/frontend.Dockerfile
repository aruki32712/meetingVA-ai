FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=development
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./
EXPOSE 3000
CMD ["pnpm", "run", "dev"]
