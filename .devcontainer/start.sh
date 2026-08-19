#!/usr/bin/env bash
# LinkIQ — GitHub Codespaces per-start hook (postStartCommand).
#
# Runs every time the container starts, including resuming a previously
# stopped Codespace — unlike setup.sh (postCreateCommand), which only
# ever runs once. Does NOT install dependencies, migrate, or seed again;
# it only (re)starts the application processes, exactly the same `npm
# run dev` command a local Windows developer runs (Sprint 19's own
# architectural rule: Codespaces provisions infrastructure, it never
# becomes something the application itself depends on).
#
# devcontainer.json's postStartCommand already wraps this ENTIRE script
# in `setsid -f` — required, discovered via a real Codespaces smoke
# test: detaching only the npm process from *inside* this script was
# not enough (the devcontainer CLI still tore it down once the script
# itself returned); only detaching at the outer invocation survives.
# Because of that outer wrapping, this script can just run `npm run
# dev` directly — no nohup/backgrounding needed here.
set -uo pipefail
cd "$(dirname "$0")/.."

mkdir -p .devcontainer/logs
exec npm run dev > .devcontainer/logs/dev.log 2>&1 < /dev/null
