# blastproof.dev

The landing page and its benchmark page. Static files, no build step:

- `index.html` — the landing page; its section-specific JS is inline
- `models.html` — *Choosing a model*, served at `/models`. Its numbers are copied from
  `docs/configuration.md` and the README's reliability table, and are updated with them
- `style.css` — the styles every page shares
- `site.js` — the version badge, the Ads conversions and the copy buttons, on every page
- `favicon.svg` — the project mark, theme-aware
- `og.png` — the preview image for shared links
- `_headers` — cache and security headers, read by Cloudflare Pages

Deployed to Cloudflare Pages from this directory. Every page carries the Google Ads tag
(`AW-18378674471`) and fires a conversion on clicks through to the repository.

This directory was briefly the only copy of the page outside a server that ran
out of memory, which is why it now lives here.
