# Explorer (code name Auspex)

Part of AUGUR, which is proprietary; see `LICENSE`.

A platform app, shown to people as Explorer (its manifest's `name`). Its id, route, intents and packages stay `auspex`.

Where you are on AUGUR: your floors and why you can go to each, who's on them, which apps you can use there, and why an app is off. It ships with AUGUR. See `docs/auspex.md` in the AUGUR repository.

- `manifest.json`: what the registry is told.
- `frontend/`: the screens (React and Quill, with d3-hierarchy for the map).
- `service/`: what changed lately, from the platform's events, in memory; names; Find.

```sh
pnpm install   # with NODE_AUTH_TOKEN set to a token that can read GitHub Packages
pnpm test && pnpm build
```

## Releases

It lives in its own repository and ships with AUGUR: CI here builds, tests, signs and releases it, and each AUGUR release takes the version pinned in AUGUR's `release/shipped-apps.json`.

| Workflow | When | What |
| --- | --- | --- |
| CI | Every pull request | Lint, typecheck, test and build |
| App previews | A pull request that changes the app | A signed preview its developers can run beside the app |
| App dev builds | Every merge into main | A signed dev build for preview servers |
| Release | Merging Version packages | The beta release `app/auspex@<version>`, which AUGUR's next release can pin |

Each needs two secrets: `PACKAGES_READ_TOKEN` (reads AUGUR's packages) and `APP_RELEASES_TOKEN` (starts AUGUR's release feed workflow).
