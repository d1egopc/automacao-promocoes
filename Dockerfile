FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /data && chown -R node:node /app /data

ENV NODE_ENV=production
ENV DATA_DIR=/data

EXPOSE 3000

USER node

CMD ["node", "index.js"]
