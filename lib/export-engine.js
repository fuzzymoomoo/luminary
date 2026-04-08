// @ts-check
'use strict';

const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');

const IMAGE_EXT = new Set(['jpg','jpeg','png','gif','bmp','webp','tif','tiff']);

class ExportEngine {
  /**
   * Copy files at full resolution to a folder.
   * @param {string[]} filePaths
   * @param {string} outputDir
   * @param {(done:number,total:number)=>void} [onProgress]
   */
  async exportHighRes(filePaths, outputDir, onProgress) {
    await fsp.mkdir(outputDir, { recursive: true });
    let done = 0;
    for (const src of filePaths) {
      const dest = await this._uniqueDest(outputDir, path.basename(src));
      await fsp.copyFile(src, dest);
      done++;
      if (onProgress) onProgress(done, filePaths.length);
    }
  }

  /**
   * Resize images to ≤maxLongEdge px, then pack everything into a zip.
   * Videos and other non-image files are included at original size.
   *
   * @param {string[]} filePaths
   * @param {string} zipPath
   * @param {{ maxLongEdge?: number, quality?: number }} [opts]
   * @param {(done:number,total:number,name:string)=>void} [onProgress]
   */
  async exportLowResZip(filePaths, zipPath, opts, onProgress) {
    // Lazy-load heavy deps so startup isn't slowed
    const Jimp     = require('jimp');
    const archiver = require('archiver');

    const maxLongEdge = opts?.maxLongEdge ?? 1500;
    const quality     = opts?.quality     ?? 80;

    await fsp.mkdir(path.dirname(zipPath), { recursive: true });

    const output  = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(output);

    const closed = new Promise((res, rej) => {
      output.on('close', res);
      output.on('error', rej);
    });

    let done = 0;
    for (const src of filePaths) {
      const ext  = path.extname(src).slice(1).toLowerCase();
      const name = path.basename(src);

      if (IMAGE_EXT.has(ext) && (ext === 'jpg' || ext === 'jpeg' || ext === 'png')) {
        try {
          const img = await Jimp.read(src);
          const w = img.getWidth(), h = img.getHeight();
          const longEdge = Math.max(w, h);
          if (longEdge > maxLongEdge) {
            const s = maxLongEdge / longEdge;
            img.resize(Math.round(w * s), Math.round(h * s));
          }
          img.quality(quality);
          const buf     = await img.getBufferAsync(Jimp.MIME_JPEG);
          const outName = name.replace(/\.[^.]+$/, '.jpg');
          archive.append(buf, { name: outName });
        } catch {
          // Fallback: include original
          archive.file(src, { name });
        }
      } else {
        archive.file(src, { name });
      }

      done++;
      if (onProgress) onProgress(done, filePaths.length, name);
    }

    await archive.finalize();
    await closed;
  }

  /**
   * Return a destination path that doesn't already exist,
   * appending _2, _3, … as needed.
   * @param {string} dir
   * @param {string} basename
   * @returns {Promise<string>}
   */
  async _uniqueDest(dir, basename) {
    const ext  = path.extname(basename);
    const stem = path.basename(basename, ext);
    let candidate = path.join(dir, basename);
    let n = 2;
    while (fs.existsSync(candidate)) {
      candidate = path.join(dir, `${stem}_${n}${ext}`);
      n++;
    }
    return candidate;
  }
}

module.exports = ExportEngine;
