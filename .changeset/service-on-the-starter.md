---
"@apps/auspex": minor
---

Explorer's service starts the one way every app's does, on service kit 0.13: `startAppService` listens, gives the registry this version's frontend, puts Explorer in the catalogue and stops cleanly on SIGTERM, and `appServer` checks the gateway's signed caller, answers every error as problem details and serves /healthz. Its refusals (signed out, no floor, too many names) are problem details too.
