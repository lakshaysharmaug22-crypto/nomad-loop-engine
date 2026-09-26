# Build from the repository root: docker build -f apps/api/Dockerfile .
# Playwright's image ships Chromium and its system libraries.
FROM mcr.microsoft.com/playwright:v1.49.1-noble AS build
WORKDIR /repo
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/engine/package.json packages/engine/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @nomad/api --workspace @nomad/engine --workspace @nomad/contracts --include-workspace-root --omit=optional
COPY packages packages
COPY apps/api apps/api
RUN npx turbo run build --filter=@nomad/api...

FROM mcr.microsoft.com/playwright:v1.49.1-noble
WORKDIR /repo
ENV NODE_ENV=production PORT=8100 DATA_DIR=/data
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 8100
CMD ["node", "dist/main.js"]
