// @ts-check
'use strict';

const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');
const vscode = require('vscode');
const { readExifDate } = require('./exif-reader');

/** Extensions we recognise as media */
const MEDIA_EXT = new Set([
  'jpg','jpeg','png','gif','bmp','tiff','tif','webp','heic','heif',
  'mp4','mov','avi','mkv','mpg','mpeg','m4v','wmv','3gp',
  'mp3','flac','wav','m4a','aac',
]);

/** Extensions we try to read EXIF from */
const EXIF_EXT = new Set(['jpg','jpeg']);

/** Extensions the webview can display as <img> */
const IMAGE_EXT = new Set(['jpg','jpeg','png','gif','bmp','webp','tif','tiff']);

/** Extensions treated as video */
const VIDEO_EXT = new Set(['mp4','mov','avi','mkv','mpg','mpeg','m4v','wmv','3gp']);

/**
 * @typedef {{
 *   path:    string,
 *   size:    number,
 *   mtime:   number,
 *   takenAt: number,
 *   ext:     string,
 *   md5?:    string,
 *   faces?:  { [personName: string]: boolean }
 * }} MediaFile
 *
 * @typedef {{ [year: string]: { [month: string]: MediaFile[] } }} Timeline
 */

class MediaScanner {
  /**
   * @param {() => string} getRootFolder
   * @param {import('vscode').ExtensionContext} _ctx  (reserved for future use)
   */
  constructor(getRootFolder, _ctx) {
    this._getRootFolder = getRootFolder;
    /** @type {MediaFile[] | null} */
    this._cache    = null;
    /** @type {Timeline | null} */
    this._timeline = null;
    this._scanning = false;

    this._onScanProgress = new vscode.EventEmitter();
    /** @type {vscode.Event<{done:number,total:number}>} */
    this.onScanProgress = this._onScanProgress.event;

    this._onScanDone = new vscode.EventEmitter();
    /** @type {vscode.Event<MediaFile[]>} */
    this.onScanDone = this._onScanDone.event;
  }

  // ── public getters ───────────────────────────────────────────────────────────

  get rootFolder() { return this._getRootFolder(); }

  get dataDir() {
    const r = this.rootFolder;
    return r ? path.join(r, '.luminary') : null;
  }

  get cachePath() {
    const d = this.dataDir;
    return d ? path.join(d, 'scan-cache.json') : null;
  }

  get isScanning() { return this._scanning; }

  isConfigured() {
    const r = this.rootFolder;
    return !!(r && fs.existsSync(r));
  }

  // ── cache control ────────────────────────────────────────────────────────────

  invalidateCache() {
    this._cache    = null;
    this._timeline = null;
  }

  /**
   * Return the already-computed timeline, or null if scan hasn't finished yet.
   * @returns {import('./media-scanner').Timeline | null}
   */
  getCachedTimeline() {
    return this._timeline;
  }

  /**
   * Kick off a scan in the background (fire-and-forget).
   * Safe to call multiple times — no-ops if already running or cached.
   */
  startBackgroundScan() {
    if (this._cache !== null || this._scanning) return;
    this.getAllFiles().catch(() => {
      this._scanning = false;
      this._onScanDone.fire([]);
    });
  }

  /** Persist current in-memory cache to disk (call after mutating md5 fields etc.) */
  async saveCacheUpdates() {
    if (!this._cache || !this.cachePath) return;
    try {
      await fsp.writeFile(this.cachePath, JSON.stringify(this._cache), 'utf-8');
    } catch {}
  }

  // ── main API ─────────────────────────────────────────────────────────────────

  /**
   * Return all media files, using disk cache where files are unchanged.
   * @returns {Promise<MediaFile[]>}
   */
  async getAllFiles() {
    if (this._cache) return this._cache;

    const root = this.rootFolder;
    if (!root || !fs.existsSync(root)) return [];

    const dataDir = this.dataDir;
    if (dataDir) await fsp.mkdir(dataDir, { recursive: true });

    // Load disk cache
    /** @type {Map<string, MediaFile>} */
    const diskCache = new Map();
    const cp = this.cachePath;
    if (cp && fs.existsSync(cp)) {
      try {
        const raw = JSON.parse(await fsp.readFile(cp, 'utf-8'));
        if (Array.isArray(raw)) for (const item of raw) diskCache.set(item.path, item);
      } catch {}
    }

    // Discover files on disk
    this._scanning = true;
    this._onScanProgress.fire({ done: 0, total: 0 });

    const discovered = await this._scanDir(root);
    const result = [];
    let done = 0;

    for (const { filePath, size, mtime } of discovered) {
      const cached = diskCache.get(filePath);
      if (cached && cached.size === size && cached.mtime === mtime) {
        result.push(cached);
      } else {
        const ext = path.extname(filePath).slice(1).toLowerCase();
        let takenAt = mtime;
        if (EXIF_EXT.has(ext)) {
          const d = readExifDate(filePath);
          if (d && d.getTime() > 0) takenAt = d.getTime();
        }
        result.push({ path: filePath, size, mtime, takenAt, ext });
      }
      done++;
      if (done % 500 === 0) this._onScanProgress.fire({ done, total: discovered.length });
    }

    this._scanning = false;
    this._cache    = result;
    this._timeline = this._buildTimeline(result); // build BEFORE firing events

    this._onScanProgress.fire({ done: result.length, total: result.length });
    this._onScanDone.fire(result);

    // Persist to disk (after events so UI is unblocked first)
    if (cp) try { await fsp.writeFile(cp, JSON.stringify(result), 'utf-8'); } catch {}

    return result;
  }

  /**
   * @param {MediaFile[]} files
   * @returns {Timeline}
   */
  _buildTimeline(files) {
    /** @type {Timeline} */
    const tl = {};
    for (const f of files) {
      const d = new Date(f.takenAt);
      const y = String(d.getFullYear());
      const m = String(d.getMonth() + 1).padStart(2, '0');
      if (!tl[y]) tl[y] = {};
      if (!tl[y][m]) tl[y][m] = [];
      tl[y][m].push(f);
    }
    return tl;
  }

  /**
   * @returns {Promise<Timeline>}
   */
  async getTimeline() {
    if (this._timeline) return this._timeline;
    const files = await this.getAllFiles();
    if (!this._timeline) this._timeline = this._buildTimeline(files);
    return this._timeline;
  }

  /**
   * @param {string} year
   * @param {string} month
   * @returns {Promise<MediaFile[]>}
   */
  async getMonthFiles(year, month) {
    const tl = await this.getTimeline();
    return (tl[year] && tl[year][month]) || [];
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /**
   * Iterative directory walk (avoids deep recursion on large trees).
   * @param {string} root
   * @returns {Promise<{filePath:string,size:number,mtime:number}[]>}
   */
  async _scanDir(root) {
    const results = [];
    const dataDir = this.dataDir;
    const stack   = [root];

    while (stack.length) {
      const dir = stack.pop();
      if (!dir || dir === dataDir) continue;

      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
      catch { continue; }

      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          stack.push(full);
        } else if (e.isFile()) {
          const ext = path.extname(e.name).slice(1).toLowerCase();
          if (MEDIA_EXT.has(ext)) {
            try {
              const s = await fsp.stat(full);
              results.push({ filePath: full, size: s.size, mtime: s.mtimeMs });
            } catch {}
          }
        }
      }
    }
    return results;
  }

  dispose() {
    this._onScanProgress.dispose();
    this._onScanDone.dispose();
  }
}

module.exports = { MediaScanner, IMAGE_EXT, VIDEO_EXT };
