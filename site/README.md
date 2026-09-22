# blastproof.dev

The landing page. Three static files, no build step:

- `index.html` — the page, self-contained (CSS and JS inline)
- `favicon.svg` — the project mark, theme-aware
- `og.png` — the preview image for shared links
- `_headers` — cache and security headers, read by Cloudflare Pages

Deployed to Cloudflare Pages from this directory. It carries the Google Ads tag
(`AW-18378674471`) and fires a conversion on clicks through to the repository.

This directory was briefly the only copy of the page outside a server that ran
out of memory, which is why it now lives here.
