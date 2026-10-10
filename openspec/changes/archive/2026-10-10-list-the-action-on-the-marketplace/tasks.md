# Tasks: list-the-action-on-the-marketplace

- [x] 1.1 `action.yml`: `name` and `description` (design D1)
- [x] 1.2 `docs/ci.md`: `version:` pinned to the current release; a test that every action ref and `version:` pin there equals `package.json` (design D2). Mutation-check it against the old `0.11.0`
  - *Done.* With the old `0.11.0` pin restored, the test fails naming `version: 0.11.0`
- [x] 1.3 `RELEASING.md`: the Marketplace step (design D3)
- [x] 1.4 Repository topic `github-actions`
- [x] 1.5 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 1.6 Archive in the same pull request, as its own commit
