FROM node:22-alpine AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM runtime AS test
COPY test ./test
CMD ["node", "--test", "test/auth.test.js", "test/domain.test.js", "test/app.test.js", "test/realtime.test.js", "test/contrato.test.js", "test/integration.test.js"]
