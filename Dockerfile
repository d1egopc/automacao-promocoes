FROM node:24-bookworm-slim

ARG MENSAGEIRO_V3_RECOVERY_DISABLED=false

WORKDIR /app

COPY package*.json ./
COPY scripts/apply-baileys-retry-hotfix.cjs ./scripts/
COPY modules/whatsapp/baileys-buffer-hotfix.service.js ./modules/whatsapp/
RUN apt-get update \
    && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /data && chown -R node:node /app /data

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV MENSAGEIRO_V3_RECOVERY_DISABLED=$MENSAGEIRO_V3_RECOVERY_DISABLED

EXPOSE 3000

USER node

CMD ["node", "index.js"]
