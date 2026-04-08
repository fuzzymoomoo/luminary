// @ts-check
'use strict';

const vscode = require('vscode');
const path   = require('path');
const fs     = require('fs');
const fsp    = require('fs/promises');
const { getNonce }             = require('../lib/utils');
const { parseFacebookExport }  = require('../lib/facebook-parser');
const { writeJpegDate, setFileMtime } = require('../lib/exif-writer');

const JPEG_EXT = new Set(['jpg', 'jpeg']);
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

class FacebookImportProvider {
  /** @param {import('vscode').ExtensionContext} ctx */
  constructor(ctx) {
    this._ctx = ctx;
    /** @type {vscode.WebviewPanel | null} */
    this._panel = null;
    this._aborted = false;

    /** @type {Map<string, Date|null> | null} */
    this._dateMap = null;
    /** @type {string | null} */
    this._postsRoot = null;
  }

  async open() {
    if (this._panel) { this._panel.reveal(); return; }

    this._panel = vscode.window.createWebviewPanel(
      'luminaryFbImport',
      'Import from Facebook',
      vscode.ViewColumn.One,
      {
        enableScripts:          true,
        retainContextWhenHidden: true,
        localResourceRoots:     [this._ctx.extensionUri],
      }
    );
    this._panel.iconPath = new vscode.ThemeIcon('cloud-upload');
    this._panel.onDidDispose(() => { this._panel = null; this._aborted = true; });
    this._panel.webview.html = this._buildHtml(this._panel.webview);

    this._panel.webview.onDidReceiveMessage(async msg => {
      switch (msg.command) {

        // ── Step 1: pick source folder ──────────────────────────────────────
        case 'pickSource': {
          const uris = await vscode.window.showOpenDialog({
            canSelectFolders: true, canSelectFiles: false,
            openLabel: 'Select Facebook "posts" folder',
          });
          if (!uris?.[0]) break;
          const chosen = uris[0].fsPath;
          // Quick sanity: check if it looks like a FB posts folder
          const hasAlbum = fs.existsSync(path.join(chosen, 'album')) ||
                           fs.existsSync(path.join(chosen, 'media'));
          this._send({ command: 'sourceChosen', folder: chosen, valid: hasAlbum });
          break;
        }

        // ── Step 2: scan ────────────────────────────────────────────────────
        case 'scan': {
          this._postsRoot = msg.folder;
          this._dateMap   = null;
          this._send({ command: 'scanStart' });
          try {
            const result = await parseFacebookExport(
              msg.folder,
              txt => this._send({ command: 'scanProgress', text: txt }),
            );
            this._dateMap = result.dateMap;
            const total      = result.dateMap.size;
            const withDate   = total - result.noDateCount;
            const noDate     = result.noDateCount;
            this._send({ command: 'scanDone', total, withDate, noDate, htmlCount: result.htmlCount });
          } catch (e) {
            this._send({ command: 'scanError', message: String(e) });
          }
          break;
        }

        // ── Step 3: pick target folder ──────────────────────────────────────
        case 'pickTarget': {
          const uris = await vscode.window.showOpenDialog({
            canSelectFolders: true, canSelectFiles: false,
            openLabel: 'Select target import folder',
          });
          if (!uris?.[0]) break;
          this._send({ command: 'targetChosen', folder: uris[0].fsPath });
          break;
        }

        // ── Step 4: run import ──────────────────────────────────────────────
        case 'import': {
          if (!this._dateMap) break;
          this._aborted = false;
          await this._runImport(msg.targetFolder, msg.copyUnknown);
          break;
        }

        case 'abort':
          this._aborted = true;
          break;
      }
    });
  }

  // ── Import engine ─────────────────────────────────────────────────────────

  /**
   * @param {string} targetRoot
   * @param {boolean} copyUnknown
   */
  async _runImport(targetRoot, copyUnknown) {
    const dateMap = /** @type {Map<string, Date|null>} */ (this._dateMap);
    const entries = [...dateMap.entries()];
    const total   = entries.length;

    this._send({ command: 'importStart', total });

    let done = 0, copied = 0, skipped = 0, errors = 0;

    for (const [srcPath, date] of entries) {
      if (this._aborted) break;
      done++;

      const name = path.basename(srcPath);
      this._send({ command: 'importProgress', done, total, file: name });

      if (!fs.existsSync(srcPath)) {
        this._send({ command: 'importLog', text: `⚠ Missing: ${name}` });
        skipped++;
        continue;
      }

      try {
        let destDir;
        if (!date) {
          if (!copyUnknown) { skipped++; continue; }
          destDir = path.join(targetRoot, 'unknown');
        } else {
          const y  = date.getFullYear();
          const mo = MONTH_NAMES[date.getMonth()];
          destDir  = path.join(targetRoot, String(y), mo);
        }

        await fsp.mkdir(destDir, { recursive: true });

        const destPath = await uniqueDest(destDir, name);
        await fsp.copyFile(srcPath, destPath);

        // Write date metadata
        const ext = path.extname(name).slice(1).toLowerCase();
        if (date) {
          if (JPEG_EXT.has(ext)) {
            await writeJpegDate(destPath, date);
          } else {
            await setFileMtime(destPath, date);
          }
        }

        this._send({ command: 'importLog', text: `✓ ${name} → ${path.relative(targetRoot, destPath)}` });
        copied++;
      } catch (e) {
        this._send({ command: 'importLog', text: `✗ ${name}: ${e}` });
        errors++;
      }
    }

    const status = this._aborted ? 'aborted' : 'done';
    this._send({ command: 'importDone', status, copied, skipped, errors, total: done });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** @param {any} msg */
  _send(msg) { this._panel?.webview.postMessage(msg); }

  /** @param {vscode.Webview} webview */
  _buildHtml(webview) {
    const nonce     = getNonce();
    const sharedDir = path.join(this._ctx.extensionPath, 'webviews', 'shared');
    const sharedCss = fs.readFileSync(path.join(sharedDir, 'styles.css'), 'utf-8');
    const sharedJs  = fs.readFileSync(path.join(sharedDir, 'components.js'), 'utf-8');
    const html = fs.readFileSync(
      path.join(this._ctx.extensionPath, 'webviews', 'facebook-import.html'), 'utf-8'
    );
    return html
      .replace('/* __SHARED_CSS__ */', sharedCss)
      .replace('/* __SHARED_JS__ */', sharedJs)
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{cspSource\}\}/g, webview.cspSource);
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * Return a destination path that doesn't already exist.
 * If `dir/name` exists, tries `dir/stem_2.ext`, `dir/stem_3.ext`, etc.
 * @param {string} dir
 * @param {string} name
 * @returns {Promise<string>}
 */
async function uniqueDest(dir, name) {
  const ext  = path.extname(name);
  const stem = path.basename(name, ext);
  let dest   = path.join(dir, name);
  let n      = 2;
  while (fs.existsSync(dest)) {
    dest = path.join(dir, `${stem}_${n}${ext}`);
    n++;
  }
  return dest;
}

module.exports = FacebookImportProvider;
