#!/usr/bin/env bash
# Build the app image on this Mac (arm64, same as the OCI A1 VM), ship it to the
# VM over SSH, and switch the running container to it.
#
#   ./deploy.sh                 build the current commit and deploy it
#   ./deploy.sh rollback        list images kept on the VM
#   ./deploy.sh rollback <tag>  switch back to one of them
#
# Needs: Docker running locally, the VM's SSH key, and access to the Terraform
# state in infra/ (host IP and site URL are read from its outputs).
# Overrides: DEPLOY_HOST=user@host  DEPLOY_SSH_KEY=path  DEPLOY_URL=https://...
set -euo pipefail
cd "$(dirname "$0")"

APP_DIR=/opt/reactive-ui
DATA_DIR=/data/reactive-ui
REPO=reactive-ui-app
KEEP_IMAGES=3

tf_out() { terraform -chdir=infra output -raw "$1"; }
HOST="${DEPLOY_HOST:-ubuntu@$(tf_out server_public_ip)}"
URL="${DEPLOY_URL:-$(tf_out site_url)}"
KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/chat_vm}"
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "$HOST")

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

# Point compose at an image that is already loaded on the VM, restart, prune old images.
switch_to() {
  "${SSH[@]}" bash -s -- "$1" "$APP_DIR" "$DATA_DIR" "$REPO" "$KEEP_IMAGES" <<'REMOTE'
set -euo pipefail
image=$1 app_dir=$2 data_dir=$3 repo=$4 keep=$5
sudo install -d -o 65532 -g 65532 -m 750 "$data_dir"   # uid of the distroless nonroot user
cd "$app_dir"
if grep -q '^APP_IMAGE=' .env; then
  sed -i "s|^APP_IMAGE=.*|APP_IMAGE=$image|" .env
else
  echo "APP_IMAGE=$image" >> .env
fi
docker compose up -d --remove-orphans
docker image ls "$repo" --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' | sort -r |
  tail -n +"$((keep + 1))" | cut -f2 | grep -vx "$image" | xargs -r docker image rm >/dev/null || true
REMOTE
}

# Wait until the public URL serves the expected revision.
wait_healthy() {
  log "health check $URL/api/health"
  local body=""
  for _ in $(seq 1 30); do
    # DNS-over-HTTPS first so a stale local DNS cache can't fail the check.
    body=$(curl -fsS -m 5 --doh-url https://1.1.1.1/dns-query "$URL/api/health" 2>/dev/null ||
      curl -fsS -m 5 "$URL/api/health" 2>/dev/null || true)
    if [[ "$body" == *"\"revision\":\"$1\""* ]]; then
      echo "    $body"
      return 0
    fi
    sleep 2
  done
  die "health check failed (last response: ${body:-none}). Roll back with: ./deploy.sh rollback"
}

case "${1:-deploy}" in
  deploy)
    rev="$(git rev-parse --short HEAD)"
    git diff --quiet HEAD -- . || rev="$rev-dirty"
    image="$REPO:$rev"

    log "build $image (linux/arm64)"
    docker build --platform linux/arm64 --build-arg APP_REVISION="$rev" -t "$image" .

    log "ship image to $HOST"
    docker save "$image" | gzip -1 | "${SSH[@]}" 'gunzip | docker load -q'

    log "sync compose file"
    scp -q -i "$KEY" deploy/compose.yaml "$HOST:$APP_DIR/compose.yaml"

    log "switch to $image"
    switch_to "$image"
    wait_healthy "$rev"
    log "deployed $image"
    ;;
  rollback)
    if [[ -z "${2:-}" ]]; then
      log "images on the VM (newest first)"
      "${SSH[@]}" "docker image ls $REPO --format '{{.CreatedAt}}  {{.Tag}}' | sort -r; grep '^APP_IMAGE=' $APP_DIR/.env"
      echo "usage: ./deploy.sh rollback <tag>"
      exit 0
    fi
    "${SSH[@]}" "docker image inspect $REPO:$2 >/dev/null 2>&1" || die "image $REPO:$2 is not on the VM"
    log "switch to $REPO:$2"
    switch_to "$REPO:$2"
    wait_healthy "$2"
    log "rolled back to $REPO:$2"
    ;;
  *) die "unknown command: $1 (use: deploy | rollback [tag])" ;;
esac
