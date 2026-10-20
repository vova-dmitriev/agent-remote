FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mini-app/package.json apps/mini-app/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/chrome-extension/package.json apps/chrome-extension/package.json
COPY scripts/build/prepare-node-pty.mjs scripts/build/prepare-node-pty.mjs
RUN npm exec --yes --package=pnpm@10.34.7 -- pnpm install --frozen-lockfile
COPY tsconfig*.json ./
COPY packages packages
COPY apps apps
COPY scripts scripts
COPY tests tests
COPY eslint eslint
COPY eslint.config.mjs playwright.config.ts playwright.extension.config.ts vitest.config.ts .prettierrc.json .prettierignore ./
RUN npm run build
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./package.json
RUN test -s package.json && test -s dist/apps/server/src/main.js && node --check dist/apps/server/src/main.js \
    && node --input-type=module -e "await import('./dist/apps/server/src/app/create-relay.js')"
USER node
EXPOSE 3000
CMD ["node","dist/apps/server/src/main.js"]
