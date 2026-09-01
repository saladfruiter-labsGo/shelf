FROM node:22-alpine

# build tools in case better-sqlite3 needs to compile for linux-musl
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

VOLUME ["/app/data"]

ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["node_modules/.bin/tsx", "server/index.ts"]
