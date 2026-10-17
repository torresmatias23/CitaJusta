#!/bin/sh
set -eu
# Read-only preflight; schema initialization is always an explicit separate command.
node /workspace/docker/api/migrate.mjs --check
exec "$@"
