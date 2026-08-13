# Tasks: refuse-an-inverted-routes-map

## 1. Detection (pure)
- [x] 1.1 Add `findInvertedRouteEntries(routes)` and the `InvertedRouteEntry` type to `src/config.ts`, with the `ROUTE_SHAPED` and `FILE_SHAPED` shapes as decided (D2–D4). Exported so it is testable without building a whole config.
- [x] 1.2 Unit tests in `tests/config.test.ts`: a correct map returns nothing; an inverted map returns the offending entries; detection is independent of the file extension (`.html`, `.css`, `.rs` — the D4 regression).

## 2. Refusal
- [x] 2.1 Attach a `superRefine` to the `routes` field of `configSchema` that raises one issue naming the first inverted entry, counting the rest, and printing the `found:` / `expected:` pair (D5, D6).
- [x] 2.2 Confirm `findUnknownConfigKeys` still never flags a route glob now that `routes` is wrapped in `ZodEffects`.
- [x] 2.3 Tests in `tests/config.test.ts`: `loadConfig` rejects with `ConfigError`; the message carries the correction; `(and N more)` appears for multiple; **and both false-positive maps still load** — a route holding a wildcard, and an absolute-looking glob.

## 3. Docs
- [x] 3.1 `src/commands/init.ts`: a comment above the scaffolded `routes:` naming which side is which, and that a test file's own `routes:` is the opposite shape.
- [x] 3.2 README "Impact mapping" and `docs/configuration.md`: state the direction and that an inverted map is refused. CHANGELOG is written at release time, not here.

## 4. Verification
- [x] 4.1 `npm run build`, `npm run typecheck`, `npm test` green.
- [x] 4.2 Against `examples/demo-app`: `run --impacted --dry-run` still selects tests from the real config; the same config inverted is refused with the expected message; the config is restored and loads again. This step is what caught D4 — verification here means running it, not reading it.
