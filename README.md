# Luminary

Luminary is a local-first VS Code extension for exploring, organizing, and exporting large photo and video collections.

It is designed for messy real-world libraries that need structure without being pushed into a cloud service or a vendor-specific catalog.

## What Luminary Does

- browse a collection by year and month
- open a month grid for quick visual review
- scan for exact duplicates and review them before sending files to the OS trash
- add tags that stay with the collection
- build a reusable people library from face recognition matches
- import a Facebook export into a clean year/month folder structure
- export either full-resolution copies or a resized zip bundle for sharing

## Principles

- local-first
- privacy-friendly
- works against a folder you choose
- no hardcoded machine paths
- metadata stays alongside the collection in a `.luminary` folder

## Current Status

Luminary is ready to run from source as a VS Code extension.

The first public goal is clarity and usability:

- a fresh user can point it at their own media library
- the repo explains what gets stored and where
- optional features fail gracefully instead of blocking the whole extension

## Requirements

- VS Code `1.85+`
- Node.js `18+` on `PATH` if you want to use face recognition
- a local photo or video collection you can point Luminary at

Face recognition will try these TensorFlow backends in order:

1. `@tensorflow/tfjs-node-gpu`
2. `@tensorflow/tfjs-node`
3. `@tensorflow/tfjs`

That means Luminary can still run when the native TensorFlow packages are unavailable, although face recognition will be slower on the pure JavaScript fallback.

## Quick Start

1. Clone the repo.
2. Run `npm install`.
3. Open the repo in VS Code.
4. Press `F5` to launch an Extension Development Host.
5. In the new window, run `Luminary: Set Root Media Folder`.
6. Pick the root folder that contains your media library.

From there you can use the Luminary activity bar to review the timeline, scan duplicates, manage tags, run exports, and open the people and Facebook import tools.

## Configuration

Luminary currently exposes one setting:

| Setting | Description | Default |
| --- | --- | --- |
| `luminary.rootFolder` | Root folder containing the photo or video collection you want Luminary to manage | empty |

## What Gets Stored

Luminary stores its working metadata inside the selected media root:

- `.luminary/scan-cache.json`
  Scan cache and derived media metadata used to speed up timeline and duplicate operations.
- `.luminary/tags.json`
  Tag assignments for files in the collection.
- `.luminary/people.json`
  Saved people records and face descriptors for face recognition.

This makes the setup portable. If you move the collection, you move the Luminary sidecar data with it.

## Safety Notes

- Timeline browsing and scanning are read-only.
- Duplicate review only removes files after an explicit confirmation, and uses the OS trash when available.
- Export creates copies. It does not overwrite originals.
- Facebook import copies media into a target folder and writes recovered dates to the copied files, not the source export.

## Documentation

- [FAQ](FAQ.md)
- [Contributor Guide](CONTRIBUTING.md)
- [Docs Index](docs/README.md)
- [Architecture Notes](docs/architecture.md)

## Roadmap Direction

Near-term work is focused on:

- packaging and release polish
- better onboarding for non-developer users
- clearer install guidance for face recognition backends
- more import and cleanup workflows

## Publishing Notes

Luminary has been cleaned up to stand on its own as a public project. The remaining release choices are mostly product-facing rather than technical, such as the final public repository remote and license choice.
