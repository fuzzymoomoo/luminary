# Luminary Architecture Notes

## Product Shape

Luminary is a VS Code extension built around a user-selected media root.

The extension does not assume a fixed machine path. Instead, the user points Luminary at a folder and the extension builds a local working model from that root.

## Core Components

- `extension.js`
  Wires together the scanner, stores, engines, and UI providers.
- `lib/media-scanner.js`
  Walks the media root, builds the timeline model, and maintains the scan cache.
- `lib/tag-store.js`
  Persists file tag assignments.
- `lib/people-store.js`
  Persists people records and saved face descriptors.
- `lib/duplicate-detector.js`
  Finds exact duplicates by grouping by size and then hashing candidate files.
- `lib/export-engine.js`
  Handles full-resolution copy export and resized zip export.
- `lib/facebook-parser.js`
  Reads Facebook export HTML and recovers dates for imported media.
- `providers/`
  VS Code-facing panels and views for timeline browsing, month grids, duplicates, tags, export, face recognition, and Facebook import.

## Storage Model

Luminary stores working data inside the selected media root:

- `.luminary/scan-cache.json`
- `.luminary/tags.json`
- `.luminary/people.json`

This is intentional.

It keeps the project portable and avoids binding the extension to a single workstation layout.

## Face Recognition Strategy

Face recognition runs in a separate Node.js worker process.

Why:

- VS Code runs extensions inside an Electron host
- native TensorFlow bindings are sensitive to ABI differences
- spawning the system `node` process avoids loading the native backend inside the extension host itself

Backend order:

1. `@tensorflow/tfjs-node-gpu`
2. `@tensorflow/tfjs-node`
3. `@tensorflow/tfjs`

The native backends are optional. Luminary should remain usable without them.

## Safety Model

- scans are read-only
- duplicate removal requires explicit confirmation
- duplicate removal uses OS trash when available
- export writes copies
- Facebook import writes to a chosen target folder, not back into the source export

## Publishing Principles

When changing Luminary, keep these rules intact:

- no hardcoded machine paths
- no dependence on private workspace layout
- local-first behavior by default
- sidecar storage should remain understandable and recoverable
