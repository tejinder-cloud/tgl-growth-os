FROM node:20-alpine AS builder

WORKDIR /app

COPY services/tgl-ops/package*.json ./
RUN npm ci

COPY services/tgl-ops/tsconfig.json ./
COPY services/tgl-ops/src ./src
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY services/tgl-ops/package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

# Copy repo configuration files so the runner can resolve agents and doors
COPY config /config

EXPOSE 3000

CMD ["node", "dist/index.js"]
