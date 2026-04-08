# Luminary Release Checklist

This is the short list of work that still needs a deliberate decision before Luminary is published publicly.

## Product And Repo Decisions

- choose the public software license
- create the public GitHub remote
- decide whether the public repo should be named `luminary` or something more specific if the name is already taken
- add final `repository`, `homepage`, and `bugs` metadata to `package.json` once the remote exists

## Extension Publishing Decisions

- decide whether the VS Code Marketplace publisher should be `fuzzymoomoo`, `fuzzy-inc`, or another stable publisher name
- decide whether the first release is source-only or packaged as a VSIX / Marketplace extension
- add Marketplace assets if needed, including a PNG icon if the extension is going to be listed publicly

## Dependency Follow-Up

- review `npm audit` findings before a public release
- decide whether native TensorFlow backends should remain optional dependencies, move behind an opt-in setup step, or be deferred until after the first public release
- evaluate whether `jimp` should be upgraded or replaced to reduce dependency risk

## Documentation Follow-Up

- add screenshots or a short demo once the UI flow is stable
- expand install guidance for face recognition on machines without native TensorFlow support
- add a small sample workflow for duplicate review, tagging, and export
