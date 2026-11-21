#!/usr/bin/env bash
# Manual deploys and one-time CI setup. Pushes to main normally deploy through
# GitHub Actions (.github/workflows/reactive-ui.yml); use this for hotfixes,
# for changes to deploy/ (compose file, VM script), and for setup.
#
#   ./deploy.sh                 build the current commit on this Mac (arm64) and deploy it
#   ./deploy.sh sync            push only deploy/ changes (compose file, VM script)
#   ./deploy.sh rollback        list images kept on the VM
#   ./deploy.sh rollback <tag>  switch back to one of them
#   ./deploy.sh setup-ci        enable GitHub secret scanning/push protection and outside-
#                               contributor approval; create the restricted CI deploy key
#                               on the VM and store it, with host/URL, in the GitHub
#                               "production" environment (main only). Re-run to rotate the key.
#
# Needs: Docker running locally, the VM admin SSH key, access to the Terraform state
# in infra/ (host IP and site URL come from its outputs), and `gh` for setup-ci.
# Overrides: DEPLOY_HOST=user@host  DEPLOY_SSH_KEY=path  DEPLOY_URL=https://...
set -euo pipefail
cd "$(dirname "$0")"

APP_DIR=/opt/reactive-ui
DATA_DIR=/data/reactive-ui
REPO=reactive-ui-app
VM_SCRIPT=/usr/local/bin/reactive-ui-deploy

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

# Install/refresh the VM-side pieces that CI cannot change: the deploy script,
# the compose file, and the data directory (owned by the distroless nonroot uid).
sync_vm() {
  log "sync VM script and compose file"
  "${SSH[@]}" "cat > /tmp/reactive-ui-deploy && sudo install -m 755 /tmp/reactive-ui-deploy $VM_SCRIPT && rm /tmp/reactive-ui-deploy" \
    <deploy/vm/reactive-ui-deploy
  "${SSH[@]}" "cat > $APP_DIR/compose.yaml" <deploy/compose.yaml
  "${SSH[@]}" "sudo install -d -o 65532 -g 65532 -m 750 $DATA_DIR"
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

    sync_vm
    log "ship image to $HOST"
    docker save "$image" | gzip -1 | "${SSH[@]}" "$VM_SCRIPT load $rev"
    log "switch to $image"
    "${SSH[@]}" "$VM_SCRIPT switch $rev"
    wait_healthy "$rev"
    log "deployed $image"
    ;;

  sync)
    # deploy/ changed (compose file, VM script) but the app did not.
    sync_vm
    log "apply compose changes"
    "${SSH[@]}" "cd $APP_DIR && docker compose up -d --remove-orphans"
    ;;

  rollback)
    if [[ -z "${2:-}" ]]; then
      log "images on the VM (newest first)"
      "${SSH[@]}" "$VM_SCRIPT status"
      echo "usage: ./deploy.sh rollback <tag>"
      exit 0
    fi
    log "switch to $REPO:$2"
    "${SSH[@]}" "$VM_SCRIPT switch $2"
    wait_healthy "$2"
    log "rolled back to $REPO:$2"
    ;;

  setup-ci)
    command -v gh >/dev/null || die "gh (GitHub CLI) is required"
    repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

    log "repo protection: secret scanning + push protection (GitHub rejects pushes containing secrets)"
    gh api -X PATCH "repos/$repo" --input - >/dev/null <<'JSON'
{"security_and_analysis": {"secret_scanning": {"status": "enabled"}, "secret_scanning_push_protection": {"status": "enabled"}}}
JSON
    # Generic patterns (private keys, connection strings, ...); optional if unsupported.
    gh api -X PATCH "repos/$repo" --input - >/dev/null 2>&1 <<'JSON' ||
{"security_and_analysis": {"secret_scanning_non_provider_patterns": {"status": "enabled"}}}
JSON
      echo "    (non-provider pattern scanning not available here; skipped)"

    log "repo protection: outside contributors' workflow runs need approval"
    gh api -X PUT "repos/$repo/actions/permissions/fork-pr-contributor-approval" \
      -f approval_policy=all_external_contributors >/dev/null

    sync_vm

    log "create GitHub environment 'production' (deployments from main only)"
    gh api -X PUT "repos/$repo/environments/production" --input - >/dev/null <<'JSON'
{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
JSON
    gh api "repos/$repo/environments/production/deployment-branch-policies" --paginate -q '.branch_policies[].name' |
      grep -qx main || gh api -X POST "repos/$repo/environments/production/deployment-branch-policies" \
      -f name=main -f type=branch >/dev/null

    log "generate a new CI deploy key (private half goes only to GitHub)"
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    ssh-keygen -q -t ed25519 -N "" -C "reactive-ui-ci" -f "$tmp/key"

    log "authorize it on the VM: forced command, no shell/forwarding (replaces any old CI key)"
    entry="restrict,command=\"$VM_SCRIPT\" $(cat "$tmp/key.pub")"
    # Guard: never write a file that lost the admin key(s).
    "${SSH[@]}" "set -e; f=~/.ssh/authorized_keys; grep -v 'reactive-ui-ci\$' \$f > \$f.new || true
      grep -q . \$f.new || { rm -f \$f.new; echo 'admin key missing, aborting' >&2; exit 1; }
      echo '$entry' >> \$f.new; chmod 600 \$f.new; mv \$f.new \$f"

    log "store secrets in the production environment"
    gh secret set DEPLOY_SSH_KEY --env production --repo "$repo" <"$tmp/key"
    gh secret set DEPLOY_HOST --env production --repo "$repo" --body "$HOST"
    gh secret set DEPLOY_URL --env production --repo "$repo" --body "$URL"
    ssh-keygen -F "${HOST#*@}" | grep -v '^#' | gh secret set DEPLOY_KNOWN_HOSTS --env production --repo "$repo"

    log "verify: the CI key can run 'status' but nothing else"
    ssh -i "$tmp/key" -o BatchMode=yes -o IdentitiesOnly=yes "$HOST" status | head -2
    if ssh -i "$tmp/key" -o BatchMode=yes -o IdentitiesOnly=yes "$HOST" "id" 2>/dev/null; then
      die "CI key could run an arbitrary command"
    fi
    echo "    arbitrary command refused (as intended)"

    log "summary"
    gh api "repos/$repo" -q '.security_and_analysis | to_entries[] | select(.key|startswith("secret_scanning")) | "    \(.key): \(.value.status)"'
    gh api "repos/$repo/actions/permissions/fork-pr-contributor-approval" -q '"    fork PR approval: \(.approval_policy)"'
    gh api "repos/$repo/environments/production/deployment-branch-policies" -q '"    production deploys allowed from: \([.branch_policies[].name] | join(", "))"'
    gh secret list --env production --repo "$repo" | awk '{print "    secret: " $1}'
    log "done: pushes to main touching the app now deploy automatically"
    ;;

  *) die "unknown command: $1 (use: deploy | sync | rollback [tag] | setup-ci)" ;;
esac
