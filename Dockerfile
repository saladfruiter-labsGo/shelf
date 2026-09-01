FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

VOLUME ["/app/data"]

ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["node_modules/.bin/tsx", "server/index.ts"]
