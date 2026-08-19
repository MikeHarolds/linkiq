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
set -uo pipefail
cd "$(dirname "$0")/.."

mkdir -p .devcontainer/logs
# Discovered via a real Codespaces smoke test (Sprint 19): plain
# `nohup ... & disown` is NOT sufficient here — Codespaces tears down
# postStartCommand's whole process group once the hook itself exits,
# killing the backgrounded `npm run dev` along with it before it ever
# writes a byte to dev.log. `setsid` gives the process its own session,
# fully detached from postStartCommand's process group, so it survives
# the hook exiting — the standard fix for this exact class of
# devcontainer lifecycle-hook problem.
setsid nohup npm run dev > .devcontainer/logs/dev.log 2>&1 < /dev/null &
disown

echo "LinkIQ dev servers starting in the background (see .devcontainer/logs/dev.log)."
echo "Web will be available on forwarded port 3000, API on forwarded port 4000."
