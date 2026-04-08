// @ts-check
'use strict';

const vscode = require('vscode');
const path   = require('path');
const fs     = require('fs');
const { getNonce } = require('../lib/utils');
const { IMAGE_EXT } = require('../lib/media-scanner');

/**
 * @typedef {import('../lib/media-scanner').MediaScanner} MediaScanner
 * @typedef {import('../lib/duplicate-detector')} DuplicateDetector
 */

class DuplicatesPanelProvider {
  /**
   * @param {import('vscode').ExtensionContext} ctx
   * @param {MediaScanner} scanner
   * @param {DuplicateDetector} detector
   */
  constructor(ctx, scanner, detector) {
    this._ctx      = ctx;
    this._scanner  = scanner;
    this._detector = detector;
    /** @type {vscode.WebviewPanel | null} */
    this._panel = null;
  }

  async open() {
    if (this._panel) { this._panel.reveal(); await this._startScan(); return; }

    this._panel = vscode.window.createWebviewPanel(
      'luminaryDuplicates',
      'Duplicates',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          this._ctx.extensionUri,
          vscode.Uri.file(this._scanner.rootFolder),
        ],
      }
    );
    this._panel.iconPath = new vscode.ThemeIcon('files');
    this._panel.onDidDispose(() => { this._panel = null; });

    this._panel.webview.html = this._buildHtml(this._panel.webview);

    this._panel.webview.onDidReceiveMessage(async (msg) => {
      if (!this._panel) return;
      switch (msg.command) {
        case 'ready':
          await this._startScan();
          break;

        case 'deleteFiles': {
          const uris = msg.filePaths.map((/** @type {string} */ p) => vscode.Uri.file(p));
          const conf = await vscode.window.showWarningMessage(
            `Move ${uris.length} file(s) to Trash?`,
            { modal: true },
            'Move to Trash'
          );
          if (conf === 'Move to Trash') {
            for (const uri of uris) {
              try { await vscode.workspace.fs.delete(uri, { useTrash: true }); } catch {}
            }
            // Invalidate cache and re-scan
            this._scanner.invalidateCache();
            await this._startScan();
          }
          break;
        }

        case 'openInExplorer':
          vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.filePath));
          break;

        case 'rescan':
          this._scanner.invalidateCache();
          await this._startScan();
          break;
      }
    });
  }

  // ── private ──────────────────────────────────────────────────────────────────

  async _startScan() {
    if (!this._panel) return;
    this._panel.webview.postMessage({ command: 'scanStart' });

    const groups = await this._detector.scan((done, total, phase) => {
      this._panel?.webview.postMessage({ command: 'progress', done, total, phase });
    });

    const webview = this._panel.webview;

    const payload = groups.map(g => ({
      hash:  g.hash,
      files: g.files.map(f => ({
        path:    f.path,
        name:    path.basename(f.path),
        ext:     f.ext,
        size:    f.size,
        takenAt: f.takenAt,
        isImage: IMAGE_EXT.has(f.ext),
        uri:     IMAGE_EXT.has(f.ext)
          ? webview.asWebviewUri(vscode.Uri.file(f.path)).toString()
          : null,
      })),
    }));

    webview.postMessage({ command: 'scanDone', groups: payload });
  }

  /** @param {vscode.Webview} webview */
  _buildHtml(webview) {
    const nonce     = getNonce();
    const sharedDir = path.join(this._ctx.extensionPath, 'webviews', 'shared');
    const sharedCss = fs.readFileSync(path.join(sharedDir, 'styles.css'), 'utf-8');
    const sharedJs  = fs.readFileSync(path.join(sharedDir, 'components.js'), 'utf-8');
    const html = fs.readFileSync(
      path.join(this._ctx.extensionPath, 'webviews', 'duplicates.html'), 'utf-8'
    );
    return html
      .replace('/* __SHARED_CSS__ */', sharedCss)
      .replace('/* __SHARED_JS__ */', sharedJs)
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{cspSource\}\}/g, webview.cspSource);
  }
}

module.exports = DuplicatesPanelProvider;
