# syntax=docker/dockerfile:1

FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js README.md server.json glama.json smithery.yaml ./
RUN chmod +x /app/index.js

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production \
  NOTARY_BASE_URL=https://notary.forgemesh.io \
  NOTARY_RAIL=base

COPY --from=build --chown=node:node /app /app

USER node

CMD ["node", "index.js"]
