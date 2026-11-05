---
'@apps/auspex-frontend': minor
---

Explorer's frontend runs on the kit's app starter (Quill 0.7): `defineReactApp` mounts it, its card on Home and its answer to "who can open this", and its places are `placeRoutes` on the address bar (`/`, `/here`, `/floors/:floor`, `/floors/:floor/apps/:app`, `/floors/:floor/replay`, `/building`, `/plant`), so Back and shared links work as before without Explorer writing the address itself. Its calls fail with the kit's `AppError`, whose message is the service's reason or that Explorer isn't answering. The tests mount the app as the shell does, with the SDK's `fakeContext`.
