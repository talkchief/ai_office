# Cloud AI Office in a container: Node 22, a Chromium for PDF export, the office on port 4520.
# Everything the office cannot recreate lives in /app/data and /app/brain; mount both.
#
#   docker build -t ai-office .
#   docker run -d --name ai-office -p 4520:4520 \
#     -v ai-office-data:/app/data -v ai-office-brain:/app/brain \
#     -e ANTHROPIC_API_KEY=... ai-office
#
# Provider keys can also be added later in Settings → Models & keys; they are kept in /app/data.
FROM node:22-bookworm-slim

# Chromium prints the PDFs (documents.mjs finds it through AO_CHROME); the fonts keep the output readable.
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
ENV AO_CHROME=/usr/bin/chromium NODE_ENV=production PORT=4520

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# The page is built with the development tools, which are then dropped from the image.
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

RUN mkdir -p /app/data /app/brain && chown -R node:node /app
USER node
VOLUME ["/app/data", "/app/brain"]
EXPOSE 4520
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:4520/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "serve.mjs"]
