FROM node:22.14.0-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && cp -r src/assets dist/assets 2>/dev/null || true

FROM node:22.14.0-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/assets ./dist/assets
COPY --from=builder /app/src/assets ./src/assets
RUN mkdir -p /app/logs/.state

EXPOSE 3000

CMD ["node", "dist/index.js"]
