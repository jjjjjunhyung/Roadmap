# syntax=docker/dockerfile:1
# One image = Rust server + built web app. Build for the OCI A1 VM (arm64):
#   docker build --platform linux/arm64 -t reactive-ui-app:dev .
# (deploy.sh does this and ships the image over SSH.)

# ---- web: React app -> static files -----------------------------------------
FROM node:22-trixie-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
# package.json pins the npm version (devEngines); match it before installing.
RUN --mount=type=cache,target=/root/.npm \
    npm install -g "npm@$(node -p 'require("./package.json").devEngines.packageManager.version')" --no-fund --no-audit \
 && npm ci --no-fund --no-audit
COPY web/ ./
RUN npm run build

# ---- server: Rust binary ------------------------------------------------------
FROM rust:1.100-slim-trixie AS server
WORKDIR /server
COPY server/Cargo.toml server/Cargo.lock ./
COPY server/src ./src
COPY server/migrations ./migrations
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/server/target \
    cargo build --release --locked \
 && cp target/release/reactive-ui-server /reactive-ui-server \
 && mkdir /data-dir

# ---- runtime: glibc-only base, no shell, runs as uid 65532 --------------------
FROM gcr.io/distroless/cc-debian13:nonroot
COPY --from=server /reactive-ui-server /app/reactive-ui-server
COPY --from=web /web/dist /app/public
# Writable data dir for the non-root user (no shell here, so copy an empty dir).
COPY --from=server --chown=65532:65532 /data-dir /data
ARG APP_REVISION=dev
ENV APP_REVISION=${APP_REVISION} \
    BIND_ADDR=0.0.0.0:8080 \
    DATABASE_URL=sqlite:///data/app.db \
    STATIC_DIR=/app/public \
    RUST_LOG=info
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/app/reactive-ui-server"]
