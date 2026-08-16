FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
# Keep the compiler below the standard 2 GiB Colima VM ceiling so BuildKit and
# the guest OS retain working memory while still avoiding Node's smaller
# architecture-dependent default heap. The local rebuild command stops the
# containers first so this bounded heap fits inside a 2 GiB Colima VM. The
# complete workspace type-check now needs slightly more than 1 GiB.
RUN NODE_OPTIONS=--max-old-space-size=1280 npm run build

FROM builder AS tools

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/prisma ./prisma
EXPOSE 3001
CMD ["node", "dist/api.js"]

FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

# Keep the combined API/static-web runtime as the default image. Compose still
# selects the dedicated `web` stage explicitly for its split-service topology.
FROM runtime AS default
