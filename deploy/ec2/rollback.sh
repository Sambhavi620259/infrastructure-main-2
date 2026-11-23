#!/usr/bin/env bash
# Point "current" at the previous release (or a named one) and restart. Code only: database migrations are NOT undone.
#   rollback.sh            -> the release before the current one
#   rollback.sh <release>  -> that release id
set -euo pipefail
ITAM_ROOT="${ITAM_ROOT:-/home/ec2-user}"
SERVICE="${ITAM_SERVICE:-itam-backend}"
SYSTEMCTL="${SYSTEMCTL:-sudo systemctl}"
HEALTH_URL="${ITAM_HEALTH_URL:-http://127.0.0.1:8000/api/health/ready}"
APP="$ITAM_ROOT/itam"; RELEASES="$ITAM_ROOT/itam-releases"
CURRENT="$(readlink "$APP/current")"
if [ -n "${1:-}" ]; then TARGET="$RELEASES/$1"
else TARGET="$(ls -1dt "$RELEASES"/*/ | sed 's#/$##' | grep -vx "$CURRENT" | head -n1)"; fi
[ -d "$TARGET" ] || { echo "no release to roll back to" >&2; exit 2; }
echo "current: $CURRENT -> $TARGET"
ln -sfn "$TARGET" "$APP/current"
$SYSTEMCTL restart "$SERVICE"
for _ in $(seq 1 30); do curl -fsS "$HEALTH_URL" >/dev/null 2>&1 && { echo "rolled back and healthy"; exit 0; }; sleep 1; done
echo "rolled back, but the health check is failing" >&2; exit 5
