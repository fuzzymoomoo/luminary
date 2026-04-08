// @ts-check
'use strict';

const fs     = require('fs');
const crypto = require('crypto');
const vscode = require('vscode');

/**
 * @typedef {import('./media-scanner').MediaFile} MediaFile
 * @typedef {{ hash: string, files: MediaFile[] }} DuplicateGroup
 */

class DuplicateDetector {
  /**
   * @param {import('./media-scanner').MediaScanner} scanner
   */
  constructor(scanner) {
    this._scanner = scanner;
    /** @type {DuplicateGroup[] | null} */
    this._groups  = null;
    this._scanning = false;

    // TreeDataProvider support (summary entry in the Duplicates tree)
    this._onDidChangeTreeData = new vscode.EventEmitter();
    /** @type {vscode.Event<any>} */
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  // ── TreeDataProvider ──────────────────────────────────────────────────────────

  /** @param {any} el */
  getTreeItem(el) { return el; }

  /** @param {any} _el */
  async getChildren(_el) {
    if (!this._scanner.isConfigured()) {
      const i = new vscode.TreeItem('No root folder set');
      i.description = 'Run "Luminary: Set Root Media Folder"';
      return [i];
    }
    if (this._scanning) {
      const i = new vscode.TreeItem('Scanning for duplicates…');
      i.iconPath = new vscode.ThemeIcon('loading~spin');
      return [i];
    }
    if (!this._groups) {
      const i = new vscode.TreeItem('Click  to scan for duplicates');
      i.iconPath = new vscode.ThemeIcon('search');
      i.command  = { command: 'luminary.scanDuplicates', title: 'Scan' };
      return [i];
    }
    if (!this._groups.length) {
      const i = new vscode.TreeItem('No duplicates found');
      i.iconPath = new vscode.ThemeIcon('check');
      return [i];
    }
    const i = new vscode.TreeItem(
      `${this._groups.length} duplicate groups — click to review`,
      vscode.TreeItemCollapsibleState.None
    );
    i.iconPath  = new vscode.ThemeIcon('files');
    i.command   = { command: 'luminary.scanDuplicates', title: 'Review' };
    return [i];
  }

  // ── public API ────────────────────────────────────────────────────────────────

  get groups() { return this._groups; }

  /**
   * Compute MD5 of a file using a stream.
   * @param {string} filePath
   * @returns {Promise<string>}
   */
  hashFile(filePath) {
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('md5');
      fs.createReadStream(filePath)
        .on('data', c => h.update(c))
        .on('end',  () => resolve(h.digest('hex')))
        .on('error', reject);
    });
  }

  /**
   * Run a full duplicate scan.
   * @param {(done:number,total:number,phase:string)=>void} [onProgress]
   * @returns {Promise<DuplicateGroup[]>}
   */
  async scan(onProgress) {
    this._scanning = true;
    this._groups   = null;
    this._onDidChangeTreeData.fire(undefined);

    try {
      const files = await this._scanner.getAllFiles();
      if (onProgress) onProgress(0, files.length, 'Grouping by size…');

      // Pre-filter by size: only hash files that share a size with at least one other file
      /** @type {Map<number, MediaFile[]>} */
      const bySize = new Map();
      for (const f of files) {
        const a = bySize.get(f.size) || [];
        a.push(f);
        bySize.set(f.size, a);
      }
      const candidates = [...bySize.values()].filter(g => g.length > 1).flat();

      if (onProgress) onProgress(0, candidates.length, 'Hashing candidates…');

      /** @type {Map<string, MediaFile[]>} */
      const byHash = new Map();
      let done = 0;
      for (const file of candidates) {
        try {
          if (!file.md5) file.md5 = await this.hashFile(file.path);
          const arr = byHash.get(file.md5) || [];
          arr.push(file);
          byHash.set(file.md5, arr);
        } catch { /* unreadable file — skip */ }
        done++;
        if (onProgress && done % 50 === 0) onProgress(done, candidates.length, 'Hashing…');
      }

      // Persist new hashes to the scan cache
      await this._scanner.saveCacheUpdates();

      this._groups = [...byHash.values()]
        .filter(g => g.length > 1)
        .map(files => ({ hash: files[0].md5 || '', files }))
        .sort((a, b) => b.files.length - a.files.length);

      return this._groups;
    } finally {
      this._scanning = false;
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  dispose() { this._onDidChangeTreeData.dispose(); }
}

module.exports = DuplicateDetector;
