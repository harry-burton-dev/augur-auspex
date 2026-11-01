# Explorer (code name Auspex)

A platform app, shown to people as Explorer (its manifest's `name`). Its id, route, intents and packages stay `auspex`.

Where you are on AUGUR: your floors and why you can go to each, who's on them, which apps you can use there, and why an app is off. It ships with AUGUR. See [docs/auspex.md](../../docs/auspex.md).

- `manifest.json`: what the registry is told.
- `frontend/`: the screens (Lit, with d3-hierarchy for the map).
- `service/`: what changed lately, from the platform's events, in memory; names; Find.

```sh
pnpm dev:app auspex
pnpm --filter "@apps/auspex*" test
```
