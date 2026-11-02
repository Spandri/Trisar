#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-check}"
LOG_MAX_SIZE="${LOG_MAX_SIZE:-20m}"
LOG_MAX_FILE="${LOG_MAX_FILE:-5}"
LARGE_LOG_THRESHOLD_MB="${LARGE_LOG_THRESHOLD_MB:-500}"

docker_disk_df() {
  docker run --rm --privileged -v /var/lib/docker:/var/lib/docker alpine sh -lc 'df -h /var/lib/docker'
}

list_large_json_logs() {
  local threshold_kb
  threshold_kb="$((LARGE_LOG_THRESHOLD_MB * 1024))"
  docker run --rm --privileged -v /var/lib/docker:/var/lib/docker alpine sh -lc "
    find /var/lib/docker/containers -type f -name '*-json.log' -size +${threshold_kb}k -print0 \
      | xargs -0 -r ls -lh 2>/dev/null || true
  "
}

read_daemon_json() {
  docker run --rm --privileged -v /etc/docker:/etc/docker alpine sh -lc '
    if [ -f /etc/docker/daemon.json ]; then cat /etc/docker/daemon.json; else echo "{}"; fi
  '
}

apply_daemon_json() {
  local current merged
  current="$(read_daemon_json)"
  merged="$(
    LOG_MAX_SIZE="$LOG_MAX_SIZE" LOG_MAX_FILE="$LOG_MAX_FILE" node -e '
      let input = "";
      process.stdin.on("data", (c) => (input += c));
      process.stdin.on("end", () => {
        let cfg = {};
        try { cfg = JSON.parse(input || "{}"); } catch { cfg = {}; }
        cfg["log-driver"] = "json-file";
        const opts = typeof cfg["log-opts"] === "object" && cfg["log-opts"] ? cfg["log-opts"] : {};
        opts["max-size"] = process.env.LOG_MAX_SIZE || "20m";
        opts["max-file"] = process.env.LOG_MAX_FILE || "5";
        cfg["log-opts"] = opts;
        process.stdout.write(JSON.stringify(cfg, null, 2));
      });
    ' <<<"$current"
  )"

  docker run --rm --privileged -e CFG="$merged" -v /etc/docker:/etc/docker alpine sh -lc '
    printf "%s\n" "$CFG" > /etc/docker/daemon.json
  '
}

reload_dockerd() {
  docker run --rm --privileged --pid=host alpine sh -lc '
    pid="$(pidof dockerd || true)";
    [ -n "$pid" ] || exit 1;
    kill -HUP "$pid";
  '
}

truncate_large_logs() {
  local threshold_kb
  threshold_kb="$((LARGE_LOG_THRESHOLD_MB * 1024))"
  docker run --rm --privileged -v /var/lib/docker:/var/lib/docker alpine sh -lc '
    find /var/lib/docker/containers -type f -name "*-json.log" -size +'$threshold_kb'k -print0 \
      | while IFS= read -r -d "" f; do
          : > "$f";
          echo "Truncated: $f";
        done
  '
}

case "$MODE" in
  check)
    echo "== Docker disk usage =="
    docker_disk_df
    echo
    echo "== daemon.json =="
    read_daemon_json
    echo
    echo "== Large Docker JSON logs (> ${LARGE_LOG_THRESHOLD_MB}MB) =="
    list_large_json_logs
    ;;
  apply)
    echo "Applying Docker JSON log rotation (${LOG_MAX_SIZE} x ${LOG_MAX_FILE})..."
    apply_daemon_json
    reload_dockerd
    echo "Done. Current daemon.json:"
    read_daemon_json
    echo
    echo "Current Docker disk usage:"
    docker_disk_df
    ;;
  cleanup)
    echo "Truncating large Docker JSON logs (> ${LARGE_LOG_THRESHOLD_MB}MB)..."
    truncate_large_logs
    echo
    docker_disk_df
    ;;
  *)
    echo "Usage: $0 [check|apply|cleanup]"
    exit 1
    ;;
esac
