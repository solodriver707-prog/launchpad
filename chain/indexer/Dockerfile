FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund   # exact, locked versions only (the server holds a hot key)
COPY *.mjs ./
RUN mkdir -p /data && chown node:node /data /app
# the server (which holds the hot key) never runs as root
USER node
ENV PORT=8787 DB=/tmp/treid.db NODE_NO_WARNINGS=1
EXPOSE 8787
CMD ["node", "indexer.mjs"]
