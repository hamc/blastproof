# Design: list-the-action-on-the-marketplace

## D1. A name with spaces

GitHub account names cannot contain spaces, so a listing name with spaces cannot collide with any account, today or later. `blastproof e2e AI testing` keeps the product's name first. It puts two search terms in the title (e2e, AI testing). The description carries the difference that matters, pull requests, because the Marketplace's search reads both.

## D2. Pins checked against `package.json`, not against each other

Checking that `docs/ci.md`'s action ref and `version:` agree with each other would pass a page that pins both to an old release. `package.json` is the version the release commit sets. Between releases it equals the last tag, so "every pin equals `package.json`" holds on `main` and fails exactly when a release forgets one surface. The same check covers the `@vX.Y.Z` refs, which the release checklist only greps for today.

## D3. The Marketplace step stays manual, and documented

Listing needs the owner to accept the Marketplace Developer Agreement, with 2FA, and to tick "Publish this Action to the GitHub Marketplace" on a release. `RELEASING.md` records the step, and records whether later releases need the box ticked again once the first listing shows it.
