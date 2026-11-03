# @apps/auspex-frontend

## 0.3.1

### Patch Changes

- Updated dependencies [9e021dd]
  - @augur/app-kit@0.3.0

## 0.3.0

### Minor Changes

- 527a413: Explorer is on React and Quill (PER-243): the map, a floor, why an app is on or off, a closed team, the building, the plant room, the replay, who can open a thing (`access.explain`) and its card on Home, with the same words and drawings. It no longer uses the Lit kit, and it now has the rail every app has: Where you are, the floor you're on, your own floor, and the building and the plant room for whoever they're for.

### Patch Changes

- 7f68faa: Auspex is shown to people as Explorer, a platform app (ADR 0032). Its id, route, intents, packages and settings stay `auspex`.
- Updated dependencies [527a413]
- Updated dependencies [f8e9b46]
- Updated dependencies [da54ae3]
- Updated dependencies [7c8027d]
- Updated dependencies [d500567]
- Updated dependencies [a8854e2]
- Updated dependencies [fccb126]
- Updated dependencies [d64d724]
  - @augur/app-kit@0.2.0
  - @augur/mfe-sdk@1.10.0

## 0.2.1

### Patch Changes

- Updated dependencies [2a05a51]
- Updated dependencies [4c1bb55]
- Updated dependencies [5ab5009]
  - @augur/ui-kit@1.8.0
  - @augur/mfe-sdk@1.9.0

## 0.2.0

### Minor Changes

- bb91780: Who can open something now includes the floors it's published up to. Artifacts' access answers list `placed`: the steps of the thing and of whatever it's inside, each with who that floor lets in, what it shows, and the floors it came up through. Share lists them under **Published up to**, and "Who can open this, explained" sends them to Auspex. Auspex reads an entry's optional `chain` and `shows` and says "Up from Payroll through Finance, showing Complete and Issued".

### Patch Changes

- Updated dependencies [bb91780]
- Updated dependencies [bef7098]
- Updated dependencies [e0e9c83]
  - @augur/mfe-sdk@1.8.0
  - @augur/ui-kit@1.7.0

## 0.1.3

### Patch Changes

- Updated dependencies [5b2c80c]
  - @augur/mfe-sdk@1.7.0

## 0.1.2

### Patch Changes

- effebfe: App kit, part 2: the frame. New `ui-app-frame` (the slate ground, a rail, the main column and an aside), `ui-page-head` (the trail of what a page is inside, its title, one line of summary, and two actions with the rest in ⋯) and `ui-section` (a labelled part with its count, one action and a why, folding after five). New token `measure-rail` (240px). Type tokens are now emitted in rem, so a person's browser text size scales them. Artifacts, Mandate, Data Atlas and Auspex use the frame and page head instead of their own grids, heads and trails.
- Updated dependencies [effebfe]
- Updated dependencies [84fab17]
- Updated dependencies [2c9caf0]
- Updated dependencies [b716037]
- Updated dependencies [2487ae0]
  - @augur/ui-kit@1.6.0

## 0.1.1

### Patch Changes

- Updated dependencies [d68128b]
- Updated dependencies [7ee3531]
- Updated dependencies [d52bfce]
- Updated dependencies [a9cfcf7]
  - @augur/ui-kit@1.5.0
  - @augur/mfe-sdk@1.6.0

## 0.1.0

### Minor Changes

- 3b11978: Who can open this, explained: Auspex handles `access.explain` over the app that asks, counting only people the person may know about and naming everyone left out, and Artifacts raises it from Who can see it.
- 1e734b3: Auspex's building, for leads and admins: the org in cross-section, each team a room above the teams inside it, everyone's own floor as doors along the ground, your way up lit as stairs, and the plant room as the basement for admins. The plant room now shows what's under way: an AUGUR upgrade and the app runner's installs as tracks of steps, the week's finished jobs, running previews, and when the updater and app runner last asked for work.
- 18bf27c: Auspex's replay of a floor's last 30 days, for its leads and admins, and the plant room, for admins: every part AUGUR runs on with a lamp, its version and how fast it answered, the backups, and the running release against the newest. The kit gains play, pause and server icons.
- b556614: Auspex: where you are on AUGUR. A map of the org with your floors lit and every other team marked closed, each floor's apps and people and what changed this week, and why you can or can't use each app, with who can change it. Ships with AUGUR.

### Patch Changes

- 1580b6b: Menu icons no longer repeat what they sit under: each app's menu group and first page now have their own icon instead of the app's.
- Updated dependencies [1580b6b]
- Updated dependencies [d324552]
- Updated dependencies [18bf27c]
- Updated dependencies [f01fcea]
- Updated dependencies [8f69cb5]
- Updated dependencies [b556614]
- Updated dependencies [513e2e9]
- Updated dependencies [feeffdd]
- Updated dependencies [ae92eed]
- Updated dependencies [778b6f9]
- Updated dependencies [513e2e9]
- Updated dependencies [28d8775]
  - @augur/mfe-sdk@1.5.0
  - @augur/ui-kit@1.4.0
