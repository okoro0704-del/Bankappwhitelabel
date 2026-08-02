# Node API for the white-label bank app (not the Vite frontend).
# On Netlify set: API_ORIGIN=https://<this-service-public-url>  (no trailing slash)

FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY src ./src

RUN npm ci && npm run build && npm prune --omit=dev

ENV NODE_ENV=production
# Railway injects PORT at runtime; do not hardcode listen address in CMD.
EXPOSE 3000

CMD ["npm", "start"]
