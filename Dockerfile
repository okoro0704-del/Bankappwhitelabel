# Node API for the white-label bank app (not the Vite frontend).
# Deploy this image to Railway / Render / Fly / any Node host.
# On Netlify set: API_ORIGIN=https://<this-service-public-url>  (no trailing slash)
# then trigger a new Netlify deploy.

FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY src ./src

RUN npm ci && npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "-r", "dotenv/config", "dist/src/index.js"]
