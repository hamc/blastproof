# blastproof.dev

The landing page, its benchmark page and its notes. Static files, no build step:

- `index.html` — the landing page; its section-specific JS is inline
- `models.html` — *Model benchmarks*, served at `/models`: accuracy, cost and time per model.
  Accuracy comes from the reliability benchmark runs behind `docs/configuration.md`'s table,
  cost from OpenRouter's billed price for the tokens a test used, time from the same runs'
  logs. The data is the `MODELS` array at the bottom of the page
- `notes/` — *Notes*, articles served at `/notes/<slug>`, listed by `notes/index.html`. Each is
  a plain HTML page with the shared nav and footer; add a new one to the index by hand
- `style.css` — the styles every page shares, the notes' included
- `site.js` — the version badge, the Ads conversions and the copy buttons, on every page
- `favicon.svg` — the project mark, theme-aware
- `og.png` — the preview image for shared links
- `_headers` — cache and security headers, read by Cloudflare Pages

Deployed to Cloudflare Pages from this directory. Every page carries the Google Ads tag
(`AW-18378674471`) and fires a conversion on clicks through to the repository.

This directory was briefly the only copy of the page outside a server that ran
out of memory, which is why it now lives here.
