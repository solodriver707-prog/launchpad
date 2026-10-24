FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY *.mjs ./
ENV PORT=8787 DB=/tmp/treid.db NODE_NO_WARNINGS=1
EXPOSE 8787
CMD ["node", "indexer.mjs"]
