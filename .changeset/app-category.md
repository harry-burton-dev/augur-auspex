---
'@apps/auspex': minor
---

The manifest says what kind of app this is (ADR 0032): a platform app: for using and managing AUGUR. Needs SDK 1.11 or later, the first that knows the kind, so an older AUGUR refuses it with a reason instead of failing to register it.
