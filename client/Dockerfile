FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN npm ci --ignore-scripts 2>/dev/null || npm install
COPY shared ./shared
COPY client ./client
RUN npm run build -w @spherio/shared && npm run build -w @spherio/client

FROM nginx:alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK CMD wget -q -O- http://127.0.0.1:80/ || exit 1
