#!/usr/bin/env bash
# Release-based deploy of the ITAM API on one EC2 host. Run ON the server, never from CI against AWS from this repo.
#
#   deploy.sh <release-tarball.tgz>
#
# Layout (override the root with ITAM_ROOT for tests):
#   $ITAM_ROOT/itam/current -> $ITAM_ROOT/itam-releases/<release-id>   (the active release)
#   $ITAM_ROOT/itam/venv                                              (Python environment, outside releases)
#   $ITAM_ROOT/itam-releases/<release-id>/backend/...                  (disposable)
#   /etc/itam/itam.env                                                 (configuration and secrets, outside releases)
# The database is RDS; uploaded files live in it too, so no release directory holds user data.
set -euo pipefail

ITAM_ROOT="${ITAM_ROOT:-/home/ec2-user}"
ENV_FILE="${ITAM_ENV_FILE:-/etc/itam/itam.env}"
SERVICE="${ITAM_SERVICE:-itam-backend}"
SYSTEMCTL="${SYSTEMCTL:-sudo systemctl}"
PYTHON="${PYTHON:-python3}"
HEALTH_URL="${ITAM_HEALTH_URL:-http://127.0.0.1:8000/api/health/ready}"
HEALTH_TRIES="${ITAM_HEALTH_TRIES:-30}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

APP="$ITAM_ROOT/itam"; RELEASES="$ITAM_ROOT/itam-releases"
TARBALL="${1:?usage: deploy.sh <release-tarball.tgz>}"
[ -f "$TARBALL" ] || { echo "no such file: $TARBALL" >&2; exit 2; }
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE (configuration lives outside the release)" >&2; exit 2; }

RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
NEW="$RELEASES/$RELEASE_ID"
mkdir -p "$RELEASES" "$APP" "$NEW"
tar -xzf "$TARBALL" -C "$NEW"
[ -d "$NEW/backend" ] || { echo "the tarball has no backend/ directory" >&2; rm -rf "$NEW"; exit 2; }

PREVIOUS=""
[ -L "$APP/current" ] && PREVIOUS="$(readlink "$APP/current")"

echo "== dependencies (pinned in requirements.txt)"
[ -x "$APP/venv/bin/python" ] || "$PYTHON" -m venv "$APP/venv"
"$APP/venv/bin/pip" install --quiet -r "$NEW/backend/requirements.txt"

echo "== validate configuration (production safety checks, no database connection)"
( set -a; . "$ENV_FILE"; set +a; cd "$NEW/backend" && "$APP/venv/bin/python" -c \
  "from app.core.config import settings; settings.check_production_safety(); print('configuration ok')" ) \
  || { echo "configuration refused; the old release keeps running" >&2; rm -rf "$NEW"; exit 3; }

echo "== database migrations (alembic upgrade head)"
( set -a; . "$ENV_FILE"; set +a; cd "$NEW/backend" && "$APP/venv/bin/python" -m alembic upgrade head ) \
  || { echo "migration failed; the old release keeps running" >&2; rm -rf "$NEW"; exit 4; }

wait_healthy() {
  for _ in $(seq 1 "$HEALTH_TRIES"); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

rollback() {
  echo "!! new release is not healthy" >&2
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
    ln -sfn "$PREVIOUS" "$APP/current"; $SYSTEMCTL restart "$SERVICE" || true
    if wait_healthy; then
      echo "rolled back to $PREVIOUS and it is healthy (code only: migrations are not undone; see README)" >&2
    else
      echo "rolled back to $PREVIOUS but it is NOT healthy either: check journalctl -u $SERVICE" >&2
    fi
  else
    echo "there is no previous release to roll back to: check journalctl -u $SERVICE" >&2
  fi
  exit 5
}

echo "== switch to $RELEASE_ID"
ln -sfn "$NEW" "$APP/current"
$SYSTEMCTL restart "$SERVICE"

echo "== health check ($HEALTH_URL)"
wait_healthy || rollback

echo "== keep the last $KEEP_RELEASES releases"
ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +"$((KEEP_RELEASES + 1))" | while read -r old; do
  [ "${old%/}" = "$(readlink "$APP/current")" ] || rm -rf "$old"
done
echo "deployed $RELEASE_ID (previous: ${PREVIOUS:-none})"
