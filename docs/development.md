# Developing Pawbreath

[Back to the README](../README.md) · [Deployment guide](deployment.md)

Run commands from the repository root.

## Local preview

The tracked `dist/` directory is the app source; no runtime build or package installation is needed for a basic preview:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory dist
```

Open <http://127.0.0.1:8766>. Use localhost HTTP or hosted HTTPS for service workers. Python exposes the introduction at `/about.html`; use `just dev` to check Cloudflare's `/about` URL and redirects.

## Development tools and checks

With Node.js 22.12+ and [just](https://github.com/casey/just):

```sh
just install        # Install locked development dependencies
just dev            # Workers preview on port 8766; accepts another port
npm test            # Node tests, release metadata and syntax checks
node tests/browser-check.mjs
just deploy-check   # Tests and Wrangler dry run; does not deploy
```

Open the browser harness's printed file to run its checks. It uses an isolated database and simulated worker registration. Actual worker upgrades require a served test; iPhone installation and lifecycle checks require the device.

## Release metadata

`package.json` owns the release version. To change it, use `npm version 1.2.1 --no-git-tag-version` with the intended version. Run `npm run release` after final app edits, then commit the changed source, package/lockfile and generated `dist/version.mjs`, `dist/release.json` and `dist/sw.js`. Tests reject stale metadata. App, backup and database versions are independent.

## Browser and device verification

The browser harness checks application behaviour in isolation. Physical Safari, installed-app lifecycle and VoiceOver checks on iPhone 12 and iPhone 17 Pro Max remain pending in the [About page verification record](dev_plans/20261115-feature-about-landing-page.md). Chromium phone-size emulation does not establish those results.

See the [development plans](dev_plans/) for decisions and verification records, and the [changelog](../CHANGELOG.md) for user-visible changes.
