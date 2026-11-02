#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.osm"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing ${ENV_FILE}. Create it from .env.osm.example" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

OSM_PBF_URL="${OSM_PBF_URL:-https://download.geofabrik.de/europe/germany/bayern/oberbayern-latest.osm.pbf}"
OSM_PBF_FILE="${OSM_PBF_FILE:-$(basename "${OSM_PBF_URL}")}"
OSRM_BASE_NAME="${OSRM_BASE_NAME:-${OSM_PBF_FILE%.osm.pbf}}"
OSRM_IMAGE="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v6.0.0}"

PBF_DIR="${ROOT_DIR}/.docker-osm/pbf"
OSRM_DIR="${ROOT_DIR}/.docker-osm/osrm"
PBF_PATH="${PBF_DIR}/${OSM_PBF_FILE}"

mkdir -p "${PBF_DIR}" "${OSRM_DIR}"

if [ ! -f "${PBF_PATH}" ]; then
  echo "Downloading ${OSM_PBF_URL}"
  curl -fL --retry 3 --retry-delay 2 -o "${PBF_PATH}" "${OSM_PBF_URL}"
else
  echo "PBF already present: ${PBF_PATH}"
fi

if [ "${FORCE_REBUILD_OSRM:-0}" = "1" ]; then
  echo "FORCE_REBUILD_OSRM=1 -> removing previous graph files for ${OSRM_BASE_NAME}"
  rm -f "${OSRM_DIR}/${OSRM_BASE_NAME}.osrm"*
fi

if [ -f "${OSRM_DIR}/${OSRM_BASE_NAME}.osrm.mldgr" ]; then
  echo "OSRM graph already prepared: ${OSRM_BASE_NAME}"
  exit 0
fi

echo "Preparing OSRM graph with image ${OSRM_IMAGE}"

docker run --rm -t \
  -v "${PBF_DIR}:/pbf" \
  -v "${OSRM_DIR}:/data" \
  "${OSRM_IMAGE}" \
  sh -lc "cp /pbf/${OSM_PBF_FILE} /data/ && osrm-extract -p /opt/car.lua /data/${OSM_PBF_FILE}"

docker run --rm -t \
  -v "${OSRM_DIR}:/data" \
  "${OSRM_IMAGE}" \
  osrm-partition "/data/${OSRM_BASE_NAME}.osrm"

docker run --rm -t \
  -v "${OSRM_DIR}:/data" \
  "${OSRM_IMAGE}" \
  osrm-customize "/data/${OSRM_BASE_NAME}.osrm"

echo "OSRM graph ready: ${OSRM_DIR}/${OSRM_BASE_NAME}.osrm.*"
