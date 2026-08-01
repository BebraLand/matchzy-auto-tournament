#!/usr/bin/env bash
set -Eeuo pipefail

BRANCH="${BRANCH:-feature/jts-hud-projection}"
EXPECTED_SHA="${EXPECTED_SHA:?Set EXPECTED_SHA to the published MAT commit}"
NEW_IMAGE="${NEW_IMAGE:-bebraland/mat:jts-hud-${EXPECTED_SHA:0:7}}"
ROLLBACK_IMAGE="${ROLLBACK_IMAGE:-bebraland/mat:rollback-before-jts-hud-${EXPECTED_SHA:0:7}}"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.operator.yml)
ROLLBACK_READY=0

rollback() {
  local code=$?
  trap - ERR
  echo "DEPLOY FAILED, restoring $ROLLBACK_IMAGE..." >&2
  if [[ "$ROLLBACK_READY" == '1' ]]; then
    if ! MAT_IMAGE="$ROLLBACK_IMAGE" "${COMPOSE[@]}" up -d \
      --no-deps --force-recreate matchzy-tournament; then
      echo "ROLLBACK FAILED: Docker Compose could not start $ROLLBACK_IMAGE." >&2
    fi
  fi
  exit "$code"
}
trap rollback ERR

[[ -d source/.git ]]
[[ -f docker-compose.yml ]]
[[ -f docker-compose.operator.yml ]]

if ! git -C source diff --quiet || ! git -C source diff --cached --quiet; then
  echo 'STOP: ~/mat/source contains uncommitted changes.' >&2
  git -C source status --short
  exit 1
fi

echo '[1/7] Updating source with fast-forward only...'
git -C source fetch origin "$BRANCH"
git -C source switch "$BRANCH"
git -C source merge --ff-only "origin/$BRANCH"
ACTUAL_SHA="$(git -C source rev-parse HEAD)"
[[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]]

echo '[2/7] Verifying persistent storage...'
mkdir -p data/map-images data/broadcast-assets backups
MAT_IMAGE="$NEW_IMAGE" "${COMPOSE[@]}" config | grep -q 'target: /app/data'

echo '[3/7] Creating compressed PostgreSQL backup...'
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="backups/pre-jts-hud-${STAMP}.sql.gz"
"${COMPOSE[@]}" exec -T postgres sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip -9 >"$BACKUP"
[[ -s "$BACKUP" ]]

echo '[4/7] Capturing rollback image...'
CURRENT_CONTAINER="$("${COMPOSE[@]}" ps -q --all matchzy-tournament | head -n 1)"
[[ -n "$CURRENT_CONTAINER" ]]
[[ "$(docker inspect --format '{{.State.Running}}' "$CURRENT_CONTAINER")" == 'true' ]]
CURRENT_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$CURRENT_CONTAINER")"
docker image tag "$CURRENT_IMAGE_ID" "$ROLLBACK_IMAGE"
ROLLBACK_READY=1

echo '[5/7] Building commit-derived MAT image...'
MAT_IMAGE="$NEW_IMAGE" "${COMPOSE[@]}" build --pull matchzy-tournament

echo '[6/7] Recreating MAT and waiting for health...'
MAT_IMAGE="$NEW_IMAGE" "${COMPOSE[@]}" up -d \
  --no-deps --force-recreate matchzy-tournament
NEW_CONTAINER="$("${COMPOSE[@]}" ps -q matchzy-tournament)"
[[ -n "$NEW_CONTAINER" ]]
HEALTH=''
for _ in $(seq 1 30); do
  HEALTH="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$NEW_CONTAINER")"
  echo "Health: $HEALTH"
  [[ "$HEALTH" == 'healthy' ]] && break
  sleep 3
done
if [[ "$HEALTH" != 'healthy' ]]; then
  docker logs --tail 150 "$NEW_CONTAINER"
  false
fi
docker exec "$NEW_CONTAINER" node -e '
require("http")
  .get("http://127.0.0.1:3069/health", response => process.exit(response.statusCode === 200 ? 0 : 1))
  .on("error", () => process.exit(1));
'

echo '[7/7] Recording immutable image ID...'
IMAGE_ID="$(docker image inspect "$NEW_IMAGE" --format '{{.Id}}')"
trap - ERR
printf '\nDEPLOY OK\nSHA:      %s\nImage:    %s\nImage ID: %s\nRollback: %s\nBackup:   %s\n' \
  "$ACTUAL_SHA" "$NEW_IMAGE" "$IMAGE_ID" "$ROLLBACK_IMAGE" "$BACKUP"
"${COMPOSE[@]}" ps
