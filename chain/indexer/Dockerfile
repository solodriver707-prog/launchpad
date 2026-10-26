FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund   # exact, locked versions only (the server holds a hot key)
COPY *.mjs ./
ENV PORT=8787 DB=/tmp/treid.db NODE_NO_WARNINGS=1
EXPOSE 8787
CMD ["node", "indexer.mjs"]
