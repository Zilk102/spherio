FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --ignore-scripts 2>/dev/null || npm install
COPY shared ./shared
COPY server ./server
RUN npm run build -w @spherio/shared && npm run build -w @spherio/server

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/server ./server
ENV COLYSEUS_PORT=2567
EXPOSE 2567
CMD ["node", "server/dist/index.js"]
