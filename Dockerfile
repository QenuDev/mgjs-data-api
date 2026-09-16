# Dockerfile
#
# One image, one process. The shape follows three measured facts about this
# server rather than a generic node template.
#
#   * `NODE_ENV=production` is load-bearing, not cosmetic. `src/logger/index.js`
#     selects the pino-pretty transport whenever NODE_ENV is not exactly
#     "production" (`src/config/index.js:67`), pino-pretty is a devDependency,
#     and `npm ci --omit=dev` removes it. pino resolves a transport target
#     synchronously at import, so the process dies before `app.listen` is ever
#     reached. Measured in this image with NODE_ENV emptied:
#         Error: unable to determine transport target for "pino-pretty"
#             at file:///app/src/logger/index.js:17:23
#     A container without NODE_ENV=production never binds. It is set here as
#     well as in the compose file so the image is correct on its own.
#   * `sharp`, `better-sqlite3` and `@napi-rs/canvas` are native and all three
#     are reachable from module scope on the boot path (audit §1.4: 254.8 ms to
#     import `src/api/server.js`, 90 modules, four native/heavy externals). The
#     builder stage carries a toolchain so `npm ci` can still compile them when
#     the prebuilt download is unavailable; the runtime stage keeps none of it.
#     Same base image on both sides, so the compiled `.node` files match the
#     glibc and Node ABI that run them — an Alpine runtime would not.
#   * Nothing is exported at first boot. `checkSpritesOnStartup()` runs
#     fire-and-forget behind `VERSION_WATCH_ENABLED` and is its only caller
#     (`src/services/spriteSync.js:469-478`); it force-exports when
#     `sprites_dump/sprite` is missing or empty (`spriteSync.js:55-71`). This
#     repository has no `sprites_dump/`, so a first boot with the watcher on
#     fetches the atlas and spends minutes decoding it. `docker-compose.yml`
#     turns the watcher and the Rive fork off; exporting is a deliberate second
#     command, not something `docker compose up` does behind you.

FROM node:22-bookworm-slim AS deps

WORKDIR /app

# `npm ci` needs the lockfile and nothing else. The toolchain is here for the
# native modules: better-sqlite3 downloads a prebuild when it can and compiles
# the SQLite amalgamation when it cannot, and a build that only succeeds with
# network access to a release CDN is not reproducible.
COPY package.json package-lock.json ./
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && npm ci --omit=dev \
 && npm cache clean --force \
 && rm -rf /var/lib/apt/lists/*


FROM node:22-bookworm-slim AS runtime

# See the header: without this the import of the logger throws.
ENV NODE_ENV=production

WORKDIR /app

# `--chown=node:node` on every copy, and no `chown -R /app` afterwards. Files
# copied as root and then chowned would be rewritten into a second layer — 129 MB
# here, because it duplicates `node_modules` — for an ownership change that can
# be made at copy time instead.
#
# Only the runtime graph travels. `src/docs/` is inside `src/` and must come
# with it: `src/docs/contract.js:23` loads openapi.yaml and
# `src/api/routes/docs.js:33` reads index.html, both at module scope.
COPY --chown=node:node package.json ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node src ./src

# The pet-animation exporter is forked by path from `animationSync.js`; it is
# disabled by default but the file it forks must exist if it is ever enabled.
COPY --chown=node:node scripts ./scripts

# The two reverse-engineering references the code cites in comments (doc-rive.md
# §3, doc-sprite.md §11). Small, and they are the only explanation of the numbers
# baked into the sprite code.
COPY --chown=node:node doc-rive.md doc-sprite.md ./

# The two writable paths, owned by the unprivileged user. Every path the server
# writes is CWD-relative in the code (`./sprites_dump`, `./data/history.sqlite`,
# `./data/events`), and CWD is `/app`, so these *are* the defaults — created here
# so the image behaves the same with or without the volumes mounted.
RUN mkdir -p /app/sprites_dump /app/data && chown node:node /app/sprites_dump /app/data

USER node

EXPOSE 3002

# `node -e` rather than curl: the runtime image is Debian slim and has no curl,
# and Node 22 has a global fetch. Reads PORT so the check follows the compose
# file instead of hard-coding a number.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Not `npm start`: npm would be PID 1 and interpose itself between the container
# runtime and the SIGTERM handler `src/index.js:56-84` installs for a graceful
# shutdown (`docker compose stop` would then wait out the timeout).
CMD ["node", "src/index.js"]
