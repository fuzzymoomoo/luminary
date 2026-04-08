# Luminary

> A local-first VS Code extension for browsing, organizing, and exporting photo and video collections.

Luminary is built for real-world media libraries: years of folders, duplicates, half-organized imports, old exports, and collections that are too personal to hand over to a cloud catalog.

It helps you make sense of that mess without locking the library to one machine or one hosted service.

## Why Luminary

Most photo tools assume one of two things:

- your library already has structure
- you are happy to upload everything into someone else's ecosystem

Luminary takes a different approach.

It works directly against a folder you choose, keeps its own sidecar metadata alongside the collection, and focuses on the practical workflows that make a neglected library usable again.

## What You Can Do Today

- browse a collection by year and month
- open a month grid for visual review
- scan for exact duplicates and review them before sending files to the OS trash
- add tags that stay with the collection
- build a reusable people library from face recognition matches
- import a Facebook export into a clean `year/month` folder structure
- export either full-resolution copies or a resized zip bundle for sharing

## What Makes It Different

- local-first by default
- no hardcoded machine paths
- sidecar metadata lives inside the chosen media root
- destructive actions require explicit confirmation
- the core experience still works even if optional AI features are unavailable

## Current Status

Luminary is early, but usable.

Right now the project is focused on making the public version solid for other people to try:

- clearer setup
- safer defaults
- better docs
- cleaner packaging for future releases

## Quick Start

```powershell
git clone https://github.com/fuzzymoomoo/luminary.git
cd luminary
npm install
code .
```

Then:

1. Press `F5` in VS Code to launch an Extension Development Host.
2. In the new window, run `Luminary: Set Root Media Folder`.
3. Choose the root folder that contains your media collection.
4. Use the Luminary activity bar to explore the timeline, review duplicates, manage tags, export files, or try people matching and Facebook import.

## Requirements

- VS Code `1.85+`
- Node.js `18+` on `PATH` if you want to use face recognition
- a local photo or video collection you can point Luminary at

Face recognition tries these TensorFlow backends in order:

1. `@tensorflow/tfjs-node-gpu`
2. `@tensorflow/tfjs-node`
3. `@tensorflow/tfjs`

So Luminary can still run when native TensorFlow packages are unavailable, although face recognition will be slower on the pure JavaScript fallback.

## Configuration

Luminary currently exposes one setting:

| Setting | Description | Default |
| --- | --- | --- |
| `luminary.rootFolder` | Root folder containing the photo or video collection you want Luminary to manage | empty |

## Storage Model

Luminary stores its working metadata inside the selected media root in a `.luminary` folder:

- `.luminary/scan-cache.json`
- `.luminary/tags.json`
- `.luminary/people.json`

That makes the setup portable. If you move the library, you move Luminary's sidecar state with it.

## Safety Notes

- timeline browsing and scanning are read-only
- duplicate review only removes files after explicit confirmation
- duplicate removal uses the OS trash when available
- export creates copies and does not overwrite originals
- Facebook import copies files into a target folder and writes recovered dates to the copied files, not the source export

## Documentation

- [FAQ](FAQ.md)
- [Contributor Guide](CONTRIBUTING.md)
- [Docs Index](docs/README.md)
- [Architecture Notes](docs/architecture.md)
- [License](LICENSE)

## Roadmap Direction

Near-term work is focused on:

- release and packaging polish
- better onboarding for non-developer users
- clearer guidance for face recognition setup
- more import and cleanup workflows

## License

Luminary is released under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).
