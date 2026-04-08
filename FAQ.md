# Luminary FAQ

## Is Luminary local-first?

Yes. Luminary works against folders on your machine and keeps its working metadata inside the selected media root.

## Does Luminary upload my photos or videos anywhere?

No. There is no cloud sync or hosted service built into the extension.

## Where does Luminary store its data?

Inside the root folder you choose, in a `.luminary` directory:

- `scan-cache.json`
- `tags.json`
- `people.json`

## Does Luminary modify my originals?

Mostly no.

- scanning and browsing are read-only
- tagging and people data are stored in `.luminary`
- export creates copies
- duplicate review can move selected files to the OS trash, but only after confirmation
- Facebook import copies files into a target folder and writes recovered dates to the copied files

## Do I need face recognition to use Luminary?

No. Face recognition is optional.

The core browsing, tagging, duplicate review, import, and export workflows do not depend on it.

## What does face recognition require?

Luminary starts a separate Node.js worker for face recognition to avoid the Electron and native module mismatch inside the VS Code extension host.

For the best experience:

- install Node.js `18+`
- make sure `node` is available on `PATH`

Luminary will try GPU TensorFlow first, then Node TensorFlow, then the plain JavaScript backend.

## Can Luminary work with videos too?

Yes, for timeline scanning, duplicate detection, and export workflows. Image-specific features such as face recognition only apply to supported image files.

## What does the Facebook import feature do?

It scans a Facebook export `posts` folder, recovers dates from the export HTML, copies the media into a target folder, and organizes it into `year/month` directories. JPEG copies get EXIF dates written where possible. Other copied files get their file modification time updated.

## How do I reset Luminary for a collection?

Close the extension host, then remove the `.luminary` folder inside the media root you configured. Luminary will rebuild its state from the collection on the next scan.

## Is Luminary a finished product?

Not yet. It is usable, but still early. The goal of this repo is to make the project understandable, configurable, and safe for other people to try and improve.
