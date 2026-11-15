# Deploying Pawbreath

[Back to the README](../README.md) · [Development guide](development.md)

Run commands from the repository root after installing the development tools.

[Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) serves `dist/` at `pawbreath.com`, with no server-side journal or runtime secrets. The site is public; visitors see only their own browser's data.

```sh
just cf-whoami      # Check authentication
just deploy        # Tests, authentication, then production deployment
```

## Credentials

Keep credentials outside the repo. These commands load `~/.secrets/cf.env` when no `CLOUDFLARE_API_TOKEN` is exported. Use shell assignments for that token and `CLOUDFLARE_ACCOUNT_ID`. An explicit `CLOUDFLARE_ENV_FILE=/absolute/path/to/file.env` overrides exported credentials; otherwise Wrangler can use its existing login. Preview and dry runs do not load this file.

## Deployment requirements

Deployment requires a clean tracked `dist/`, including no ignored/untracked files: everything there can become public. Wrangler manages the apex custom domain; Cloudflare's dashboard separately manages HTTP/`www` redirects to HTTPS apex, preserving paths/queries. Keep the `www` placeholder A record (`192.0.2.0`) proxied and the redirect enabled. `dist/_headers` sets the security policy and cache controls. The host must serve shell files byte-for-byte (no HTML rewriting, minification or injection); the service worker verifies each file's SHA-256 at install, so any change makes installation fail and offline mode will not activate. After deployment, verify HTTPS, redirects, offline reopening and the installed app.
