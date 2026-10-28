# iSpy a Spy server: one persistent Node process with SQLite on a mounted volume.
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Workspace install: the server depends on @ispy/shared through the npm workspace.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci --workspace server --include-workspace-root --omit=dev --ignore-scripts \
  && npm install --no-save tsx@4 typescript@5 \
  && npm cache clean --force

COPY shared ./shared
COPY server ./server

# The database lives on the volume; the seed runs on boot if the tables are empty.
ENV ISPY_DB=/data/ispy.db PORT=4000 HOST=0.0.0.0
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 4000
WORKDIR /app/server
CMD ["npx", "tsx", "src/index.ts"]
