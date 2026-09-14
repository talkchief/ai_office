#!/usr/bin/env bash
# The sandbox broker on this server: a user of its own running rootless Podman, the office service in its group, CPU and memory
# limits delegated to it, the image, and the service. Run as root; safe to run again.
#
#   deploy/sandbox/setup.sh          everything
#   deploy/sandbox/setup.sh image    rebuild the image only (after a change to sandbox/Containerfile)
#
# Afterwards restart the office service once (systemctl restart agents-office) so it joins the broker's group.
set -euo pipefail
REPO=${REPO:-/opt/agents-office}
SANDBOX_USER=ao-sandbox
SANDBOX_HOME=/var/lib/ao-sandbox
OFFICE_USER=${OFFICE_USER:-agents-office}
IMAGE=${AO_SANDBOX_IMAGE:-localhost/ao-sandbox:latest}
NODE_BIN=${NODE_BIN:-/opt/agents-office-runtime/bin/node}

[ "$(id -u)" = 0 ] || { echo "Run as root." >&2; exit 1; }
as_sandbox() { local uid; uid=$(id -u "$SANDBOX_USER"); (cd "$SANDBOX_HOME" && sudo -u "$SANDBOX_USER" env HOME="$SANDBOX_HOME" XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" PATH=/usr/local/bin:/usr/bin:/bin "$@"); }
build_image() {
  echo "building $IMAGE (a few minutes the first time)"
  as_sandbox podman build --pull=newer --tag "$IMAGE" --file "$REPO/sandbox/Containerfile" "$REPO/sandbox"
  as_sandbox podman image prune --force >/dev/null || true
}
if [ "${1:-}" = image ]; then build_image; exit 0; fi

# 1. The user: no login shell, a home of its own for Podman's storage.
id -u "$SANDBOX_USER" >/dev/null 2>&1 || useradd --system --home-dir "$SANDBOX_HOME" --create-home --shell /sbin/nologin --comment 'Agents Office sandbox broker' "$SANDBOX_USER"
mkdir -p "$SANDBOX_HOME" && chown "$SANDBOX_USER:$SANDBOX_USER" "$SANDBOX_HOME" && chmod 0700 "$SANDBOX_HOME"
uid=$(id -u "$SANDBOX_USER")

# 2. Subordinate user and group ids: a container's users map to ids nobody else on the machine has.
if ! grep -q "^$SANDBOX_USER:" /etc/subuid; then usermod --add-subuids 100000-165535 "$SANDBOX_USER"; fi
if ! grep -q "^$SANDBOX_USER:" /etc/subgid; then usermod --add-subgids 100000-165535 "$SANDBOX_USER"; fi

# 3. The office service reaches the broker's socket through the broker's group.
if ! id -nG "$OFFICE_USER" | tr ' ' '\n' | grep -qx "$SANDBOX_USER"; then usermod --append --groups "$SANDBOX_USER" "$OFFICE_USER"; fi

# 4. A systemd user instance for the broker's user, so containers get cgroups; CPU delegated as well as memory and processes.
loginctl enable-linger "$SANDBOX_USER"
mkdir -p /etc/systemd/system/user@.service.d
cat > /etc/systemd/system/user@.service.d/delegate.conf <<'EOF'
[Service]
Delegate=cpu cpuset io memory pids
EOF
systemctl daemon-reload
systemctl restart "user@$uid.service" 2>/dev/null || systemctl start "user@$uid.service"
for _ in $(seq 1 30); do [ -S "/run/user/$uid/bus" ] && break; sleep 1; done
as_sandbox podman system migrate >/dev/null 2>&1 || true

# 5. The office's data is its own: no other user on the machine (the broker's included) may read it.
for d in "$REPO/data" "$REPO/tenants"; do [ -d "$d" ] && chmod o-rwx "$d"; done

# 6. The image, then the service.
build_image
sed -e "s|@UID@|$uid|g" -e "s|@REPO@|$REPO|g" -e "s|@NODE@|$NODE_BIN|g" -e "s|@IMAGE@|$IMAGE|g" "$REPO/deploy/sandbox/ao-sandbox-broker.service" > /etc/systemd/system/ao-sandbox-broker.service
systemctl daemon-reload
systemctl enable ao-sandbox-broker.service >/dev/null
systemctl restart ao-sandbox-broker.service
for _ in $(seq 1 20); do [ -S /run/ao-sandbox/broker.sock ] && break; sleep 1; done
echo "sandbox broker: $(systemctl is-active ao-sandbox-broker.service) on /run/ao-sandbox/broker.sock"
echo "next: systemctl restart agents-office (it joins the $SANDBOX_USER group), then node scripts/sandbox-smoke.mjs"
