---
'@apps/auspex': minor
---

Explorer says what kind of app each one is (AUGUR ADR 0032). Its manifest calls it a platform app, and it needs SDK 1.11 or later, the first that knows the kind, so an older AUGUR refuses it with a reason instead of failing to register it. A floor's apps come in two groups, "For your work" then "For using AUGUR", and an app's answer says in one sentence what kind it is and whether it ships with AUGUR. A built-in app's step now reads "It’s built into AUGUR".
