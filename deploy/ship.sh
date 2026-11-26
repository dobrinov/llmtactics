#!/bin/bash
# Deploy the last commit to the shared host. Usage: deploy/ship.sh [ref]
# Streams `git archive` of the ref (default HEAD) to the server, builds the
# image there, restarts the container and waits for its health check.
# Uncommitted changes are never shipped. Roll back with: deploy/ship.sh <older sha>
set -euo pipefail

HOST="${LLMTACTICS_HOST:-root@89.167.69.250}"
KEY="${LLMTACTICS_SSH_KEY:-$HOME/.ssh/hetzner}"
REF="${1:-HEAD}"
SHA=$(git rev-parse --short "$REF")
cd "$(git rev-parse --show-toplevel)"

[ -z "$(git status --porcelain --untracked-files=no)" ] || echo "note: uncommitted changes are not shipped"
echo "==> shipping $(git log --oneline -1 "$REF")"

git archive --format=tar "$REF" | ssh -i "$KEY" -o BatchMode=yes "$HOST" "
  set -euo pipefail
  cd /opt/apps/llmtactics
  # Keep the running image as :previous. Docker sometimes refuses to move the
  # tag (\"already exists\"); that only loses the shortcut, so carry on.
  if docker image inspect llmtactics:latest >/dev/null 2>&1; then
    docker tag llmtactics:latest llmtactics:previous 2>/dev/null \
      || echo '    note: could not tag llmtactics:previous; roll back with deploy/ship.sh <sha>'
  fi
  echo '==> building'
  docker build -q -t llmtactics:latest --label commit=$SHA - >/dev/null
  echo '==> starting'
  docker compose up -d --quiet-pull
  echo '==> waiting for health'
  for i in \$(seq 1 60); do
    status=\$(docker inspect -f '{{.State.Health.Status}}' llmtactics-web 2>/dev/null || echo starting)
    [ \"\$status\" = healthy ] && { echo '    healthy'; break; }
    [ \"\$status\" = unhealthy ] && { echo '    UNHEALTHY: docker compose -f /opt/apps/llmtactics/compose.yaml logs web'; exit 1; }
    sleep 3
  done
  [ \"\$status\" = healthy ] || { echo '    not healthy after 3 minutes'; exit 1; }
  docker image prune -f >/dev/null
  echo '==> live: $SHA'
"
