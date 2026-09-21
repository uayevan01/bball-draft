#!/usr/bin/env bash
# Create / update the weekly Basketball Reference seed Machine on Fly.io.
#
# Prerequisites:
#   fly auth login
#   Deploy the backend at least once with scripts/seed_refresh.sh in the image
#   DATABASE_URL already set as an app secret (fly secrets list)
#
# Usage (from backend/):
#   ./scripts/fly_seed_machine.sh create    # one-time: create weekly scheduled Machine
#   ./scripts/fly_seed_machine.sh update    # after each deploy: point Machine at latest image
#   ./scripts/fly_seed_machine.sh status
#
# Notes:
#   - Do NOT use --rm: the Machine must persist so the schedule can restart it.
#   - --restart=no: exit after the job finishes; schedule starts it again later.
#   - create starts the Machine immediately (first run). update uses --skip-start.
set -euo pipefail

APP="${FLY_APP:-backend-falling-cloud-890}"
REGION="${FLY_REGION:-ewr}"
MACHINE_NAME="${FLY_SEED_MACHINE_NAME:-seed-refresh}"
SCHEDULE="${FLY_SEED_SCHEDULE:-weekly}"
MEMORY_MB="${FLY_SEED_MEMORY_MB:-2048}"
CPUS="${FLY_SEED_CPUS:-1}"
SEED_CMD="/app/scripts/seed_refresh.sh"
CONFIG_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cmd="${1:-}"
if [[ -z "${cmd}" ]]; then
  echo "Usage: $0 {create|update|status}" >&2
  exit 2
fi

require_fly() {
  if ! command -v fly >/dev/null 2>&1; then
    echo "flyctl not found. Install: https://fly.io/docs/flyctl/install/" >&2
    exit 1
  fi
  if ! fly auth whoami >/dev/null 2>&1; then
    echo "Not logged in to Fly. Run: fly auth login" >&2
    exit 1
  fi
}

latest_image() {
  local image=""
  # fly releases --image prints a table; JSON is more reliable when available.
  image="$(
    fly releases -a "${APP}" --image -j 2>/dev/null | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
if not raw:
    raise SystemExit(0)
data = json.loads(raw)
items = data if isinstance(data, list) else (
    data.get("releases") or data.get("Items") or data.get("data") or []
)
for r in items:
    img = r.get("ImageRef") or r.get("imageRef") or r.get("image") or r.get("Image")
    if img:
        print(img)
        break
' 2>/dev/null || true
  )"
  if [[ -z "${image}" ]]; then
    image="$(
      fly image show -a "${APP}" 2>/dev/null | python3 -c '
import sys, re
text = sys.stdin.read()
# Match registry.fly.io/app:deployment-...
m = re.search(r"registry\.fly\.io/\S+", text)
if m:
    print(m.group(0).rstrip(".,"))
' 2>/dev/null || true
    )"
  fi
  if [[ -z "${image}" ]]; then
    echo "Could not resolve deployed image for ${APP}. Deploy once, then retry." >&2
    exit 1
  fi
  echo "${image}"
}

find_machine_id() {
  fly machine list -a "${APP}" -j | python3 -c '
import json, sys
name = sys.argv[1]
data = json.load(sys.stdin)
items = data if isinstance(data, list) else data.get("machines") or []
for m in items:
    if m.get("name") == name or m.get("Name") == name:
        print(m.get("id") or m.get("ID") or "")
        break
' "${MACHINE_NAME}"
}

case "${cmd}" in
  status)
    require_fly
    echo "App: ${APP}  Machine name: ${MACHINE_NAME}"
    fly machine list -a "${APP}"
    mid="$(find_machine_id || true)"
    if [[ -n "${mid}" ]]; then
      echo
      fly machine status "${mid}" -a "${APP}"
    else
      echo "No machine named ${MACHINE_NAME} found."
    fi
    ;;

  create)
    require_fly
    existing="$(find_machine_id || true)"
    if [[ -n "${existing}" ]]; then
      echo "Machine ${MACHINE_NAME} already exists (${existing}). Use: $0 update" >&2
      exit 1
    fi
    image="$(latest_image)"
    echo "Creating scheduled Machine ${MACHINE_NAME} on ${APP}"
    echo "  image:    ${image}"
    echo "  schedule: ${SCHEDULE}"
    echo "  region:   ${REGION}"
    echo "  memory:   ${MEMORY_MB}MB"
    echo "  command:  ${SEED_CMD}"
    echo
    echo "This starts the first seed run immediately (can take many hours)."
    # Run from backend/ so fly.toml is found if needed; image is explicit.
    (
      cd "${CONFIG_DIR}"
      fly machine run "${image}" \
        --app "${APP}" \
        --name "${MACHINE_NAME}" \
        --region "${REGION}" \
        --schedule "${SCHEDULE}" \
        --restart no \
        --vm-memory "${MEMORY_MB}" \
        --vm-cpus "${CPUS}" \
        --env "SEED_STALE_DAYS=${SEED_STALE_DAYS:-14}" \
        --env "SEED_CONCURRENCY=${SEED_CONCURRENCY:-3}" \
        --metadata role=seed-refresh \
        --skip-dns-registration \
        --detach \
        "${SEED_CMD}"
    )
    echo
    echo "Created. After future deploys, refresh the image with: $0 update"
    ;;

  update)
    require_fly
    mid="$(find_machine_id || true)"
    if [[ -z "${mid}" ]]; then
      echo "No machine named ${MACHINE_NAME}. Create it first: $0 create" >&2
      exit 1
    fi
    image="$(latest_image)"
    echo "Updating ${MACHINE_NAME} (${mid}) -> ${image}"
    (
      cd "${CONFIG_DIR}"
      fly machine update "${mid}" \
        -a "${APP}" \
        --image "${image}" \
        --command "${SEED_CMD}" \
        --restart no \
        --schedule "${SCHEDULE}" \
        --vm-memory "${MEMORY_MB}" \
        --vm-cpus "${CPUS}" \
        --metadata role=seed-refresh \
        --skip-dns-registration \
        --skip-start \
        --yes
    )
    echo "Updated. Schedule remains ${SCHEDULE}; next run uses the new image."
    ;;

  *)
    echo "Usage: $0 {create|update|status}" >&2
    exit 2
    ;;
esac
