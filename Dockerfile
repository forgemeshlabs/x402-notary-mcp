FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js README.md LICENSE server.json glama.json smithery.yaml ./
RUN chmod +x /app/index.js

ENV NODE_ENV=production \
  NOTARY_BASE_URL=https://notary.forgemesh.io \
  NOTARY_RAIL=base

USER node

RUN (npm install) && (npm run build)
CMD ["mcp-proxy","--","node","./server.js"]/

ENTRYPOINT ["node", "index.js"]
