# Repository Guide

## Purpose

This repository contains the rules/content runtime and the Electron Windows distribution for 《废土末班车》. Keep research/source material separate from player-facing release artifacts.

## Local inspection

When FastCtx MCP file tools are available, prefer `inspect_local_file`, `grep`, and `glob` for reading and searching. Use `replace` for mechanical batch replacement and `apply_patch` for semantic edits.

## Architecture

- `packages/dsh-feitu-world/`: authoritative game rules, content, API, and player UI.
- `desktop/electron/`: secure desktop shell and release scripts.
- `tools/stage-release.mjs`: creates the player-runtime allowlist snapshot.
- `release/manifests/`: release inclusion policy.
- `release/staging/steam-windows/`: generated Steam Depot candidate.
- `release/staging/github-windows/`: generated portable GitHub candidate.
- `release/artifacts/`: generated archives, checksums, and candidate manifests.
- `PROJECT_STATE.md`: current verified release state and external blockers.

## Runtime and package policy

- Use Node.js 22.12 or newer and npm with `desktop/electron/package-lock.json`.
- Do not introduce absolute user-machine paths, a second lockfile, or a second desktop runtime.
- Player saves and logs must remain under Electron `userData`, never the install directory.
- Steam builds use SteamPipe for updates; do not add a competing in-app updater to the Steam channel.

## Canonical desktop commands

Run from `desktop/electron/`:

```powershell
npm.cmd run verify
npm.cmd run release:steam
npm.cmd run release:verify
npm.cmd run release:github
npm.cmd run release:github:verify
```

Use `npm.cmd run version:set -- <semver>` for version changes. Do not edit only one package version by hand.

## Release boundaries

- Do not hand-edit generated content under `release/staging/`, `release/build/`, or generated archives.
- Do not ship `node_modules`, research data, source novels, local saves, logs, API keys, test traces, or caches.
- Do not publish to Steam default/public automatically; test a beta/Playtest branch and promote manually.
- Do not publicly sell or distribute the adapted story until commercial adaptation rights and the final project license are confirmed.
