FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080
ENV STATE_DIR=/data

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public

RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 8080

CMD ["node", "server.js"]
