# Releasing blastproof

This is a maintainer's checklist. Nothing here is needed to open a pull request — see [CONTRIBUTING.md](CONTRIBUTING.md) for that.

Publishing runs from a tag, never from a merge — a released version can never be edited and the package name is claimed permanently, so it takes a deliberate act:

One commit moves every version surface together — `package.json`, the changelog entry, and the Action example in `docs/ci.md`, both its `uses:` refs and its `version:` pin — and the tag points at it:

```bash
# in one commit: bump package.json, write the CHANGELOG entry, update every
# `uses: hamc/blastproof@vX.Y.Z` and `version:` in docs/ci.md, then
grep -rn 'blastproof@v' README.md docs/   # nothing older than the new tag
git tag v0.1.0 && git push origin v0.1.0
```

The Action example lived in the README until 0.12.0 and this checklist still said so afterwards —
the grep is here because a version surface that moves is exactly the one a checklist stops finding.
The `version:` pin was such a surface: from 0.12.0 to 0.24.0 the example installed the 0.11.0 CLI.
`tests/action-manifest.test.ts` now fails when any pin in `docs/ci.md` differs from `package.json`.

The changelog entry is written **here**, not in the pull requests, and it is derived from what has landed since the last tag:

```bash
git log --oneline v0.1.0..main
```

Read that list before tagging. 0.7.0 shipped without a changelog entry because nobody did, and every other surface agreed with itself — which is exactly why the one that disagreed went unnoticed.

If anything in that list changes how a step is executed or judged, run `npm run eval:reliability` on the reference pair before tagging (see [CONTRIBUTING.md](CONTRIBUTING.md#measuring-how-often-a-verdict-is-wrong)). If the README's reliability table no longer describes the release, update it.

The release workflow refuses to publish if the tag and the manifest version disagree, rebuilds and re-runs the full verification, and publishes with npm provenance. It needs an `NPM_TOKEN` secret on the repository.

`npm view blastproof version` can lag the workflow by a few minutes — `npm notice Your package is being processed` is the publish succeeding, not failing. Check the registry again before concluding anything went wrong.

## The workflow does not create the GitHub Release

Publishing to npm and tagging are automated. The Release on the repository's front page is not, and nothing fails when it is missing:

```bash
gh release create vX.Y.Z --title "vX.Y.Z — <lowercase phrase>" --latest --notes-file <notes>
```

0.16.0 shipped to npm with the tag pushed and no Release, so the repository kept announcing 0.15.0 as the latest version to everyone who visited. It was caught by a person looking, which is the same way every version-surface gap here has been caught.

The notes are narrative and worth more than the changelog entry they are drawn from: the changelog says what changed, the Release says why it mattered. Match the house format — `vX.Y.Z — <lowercase phrase>` for the title — by reading the previous one.

## Listing the Action on the GitHub Marketplace

The Action is listed as **blastproof e2e AI testing**, not `blastproof`. The Marketplace refuses a name that matches a GitHub account it is not published by, and an organization `blastproof` exists that is not ours. Keep a space in the `name:` of `action.yml`; `tests/action-manifest.test.ts` checks it.

Listing is manual, from the release page, because GitHub has no API for it:

1. Open the release (`gh release create` makes it) and choose **Edit**.
2. Tick **Publish this Action to the GitHub Marketplace**. The first time, accept the Marketplace Developer Agreement; the account needs two-factor authentication.
3. The metadata check must say **Everything looks good!**. Primary category **Testing**, secondary **Continuous integration**.
4. **Update release**, then check `https://github.com/marketplace/actions/blastproof-e2e-ai-testing`.

First listed with 0.25.0, on 2026-10-10. Whether a later release must tick the box again, or is picked up by the listing on its own, is not known yet: check the listing's version after the next release and record the answer here.
