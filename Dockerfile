FROM node:22-alpine AS build

# build tools in case better-sqlite3 needs to compile for linux-musl
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# runtime artifacts only (no build toolchain)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json

VOLUME ["/app/data", "/app/backups"]

ENV PORT=3000
ENV DATA_DIR=/app/data
ENV BACKUP_DIR=/app/backups

EXPOSE 3000

CMD ["node_modules/.bin/tsx", "server/index.ts"]
