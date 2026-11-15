# Pawbreath

A mobile-first breathing journal for dogs. Count their resting breaths, keep a history, and export readings to share with your vet.

[Open Pawbreath](https://pawbreath.com/) · [About and phone installation](https://pawbreath.com/about)

![Pawbreath measurement screen with a sample Milo profile and latest reading](docs/images/pawbreath-preview.png)

Local preview with fictional sample data.

## What you can do

- Count for 30 or 60 seconds by tapping once per breath, with optional quiet tap sounds.
- Keep separate dog profiles, photos, notes and measurement context, or enter a reading manually.
- View history charts and silently replay the tap timing of new counts.
- Download JSON backups and export CSV readings to share.
- Install on your phone and use the journal offline after setup.

Each browser keeps its own journal on your device. There are no accounts or automatic sync; download backups regularly, especially before changing devices or clearing browser data. The About page needs an internet connection.

## Try it locally

With Node.js 22.12+ and [just](https://github.com/casey/just), run:

```sh
just install
just dev
```

Open <http://127.0.0.1:8766> for the journal or <http://127.0.0.1:8766/about> for the introduction. The tracked `dist/` directory is the app source; there is no runtime build step.

## Documentation

- [User guide](docs/user-guide.md) — installation, counting, tap replay, storage, backups and app updates.
- [Development guide](docs/development.md) — local setup, testing, browser checks and release metadata.
- [Deployment guide](docs/deployment.md) — Cloudflare commands, credentials and hosting requirements.
- [Changelog](CHANGELOG.md) — user-visible changes.
- [Development plans](docs/dev_plans/) — design decisions and verification records.
