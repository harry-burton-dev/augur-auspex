# @apps/auspex

## 0.3.3

### Patch Changes

- dbc6c72: The wire types between the frontend and the service are written once, in the service's src/api-types.ts, and both sides use them. Types only: the frontend bundle and the service build don't change.
- e02eb5e: The manifest's SDK range also accepts SDK 2. SDK 2 only stops serving Lit, which this app never used, so the
  app keeps opening when a deployment moves to an AUGUR shell built on SDK 2.

## 0.3.2

### Patch Changes

- f710322: Explorer is built and released from its own repository now, signed by this repository's release workflow. Nothing changes for people using it.

## 0.1.2

### Patch Changes

- 7f68faa: Auspex is shown to people as Explorer, a platform app (ADR 0032). Its id, route, intents, packages and settings stay `auspex`.
- Updated dependencies [137791c]
- Updated dependencies [2021f8a]
  - @augur/service-kit@0.11.0

## 0.1.1

### Patch Changes

- Updated dependencies [ea41136]
  - @augur/service-kit@0.10.0

## 0.1.0

### Minor Changes

- b556614: Auspex: where you are on AUGUR. A map of the org with your floors lit and every other team marked closed, each floor's apps and people and what changed this week, and why you can or can't use each app, with who can change it. Ships with AUGUR.

### Patch Changes

- Updated dependencies [f0d02e2]
- Updated dependencies [bbdad18]
  - @augur/service-kit@0.9.0
