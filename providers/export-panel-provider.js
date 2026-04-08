// @ts-check
'use strict';

const vscode = require('vscode');
const path   = require('path');
const fs     = require('fs');
const { getNonce } = require('../lib/utils');

/**
 * @typedef {import('../lib/media-scanner').MediaScanner} MediaScanner
 * @typedef {import('../lib/export-engine')} ExportEngine
 */

class ExportPanelProvider {
  /**
   * @param {import('vscode').ExtensionContext} ctx
   * @param {MediaScanner} scanner
   * @param {ExportEngine} engine
   */
  constructor(ctx, scanner, engine) {
    this._ctx     = ctx;
    this._scanner = scanner;
    this._engine  = engine;
    /** @type {vscode.WebviewPanel | null} */
    this._panel = null;
    /** @type {string[]} */
    this._pendingSelection = [];
  }

  /**
   * @param {string[]} [initialSelection]
   */
  async open(initialSelection) {
    if (initialSelection?.length) this._pendingSelection = initialSelection;

    if (this._panel) {
      this._panel.reveal();
      if (this._pendingSelection.length) {
        this._panel.webview.postMessage({ command: 'addSelection', filePaths: this._pendingSelection });
        this._pendingSelection = [];
      }
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      'luminaryExport',
      'Export',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this._ctx.extensionUri],
      }
    );
    this._panel.iconPath = new vscode.ThemeIcon('cloud-download');
    this._panel.onDidDispose(() => { this._panel = null; });

    this._panel.webview.html = this._buildHtml(this._panel.webview);

    this._panel.webview.onDidReceiveMessage(async (msg) => {
      if (!this._panel) return;
      switch (msg.command) {
        case 'ready':
          if (this._pendingSelection.length) {
            this._panel.webview.postMessage({ command: 'addSelection', filePaths: this._pendingSelection });
            this._pendingSelection = [];
          }
          await this._sendTimeline();
          break;

        case 'pickOutputFolder': {
          const uri = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles:   false,
            openLabel:        'Select Output Folder',
          });
          if (uri?.[0]) {
            this._panel?.webview.postMessage({ command: 'outputFolder', folder: uri[0].fsPath });
          }
          break;
        }

        case 'pickZipPath': {
          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(require('os').homedir(), 'export.zip')),
            filters: { 'Zip archive': ['zip'] },
          });
          if (uri) {
            this._panel?.webview.postMessage({ command: 'zipPath', zipPath: uri.fsPath });
          }
          break;
        }

        case 'exportHighRes': {
          const { filePaths, outputDir } = msg;
          if (!filePaths?.length || !outputDir) break;
          this._panel.webview.postMessage({ command: 'exportProgress', phase: 'Copying…', done: 0, total: filePaths.length });
          try {
            await this._engine.exportHighRes(filePaths, outputDir, (done, total) => {
              this._panel?.webview.postMessage({ command: 'exportProgress', phase: 'Copying…', done, total });
            });
            vscode.window.showInformationMessage(`Exported ${filePaths.length} files to ${outputDir}`);
            this._panel?.webview.postMessage({ command: 'exportDone', success: true });
          } catch (e) {
            vscode.window.showErrorMessage(`Export failed: ${e}`);
            this._panel?.webview.postMessage({ command: 'exportDone', success: false, error: String(e) });
          }
          break;
        }

        case 'exportLowRes': {
          const { filePaths, zipPath } = msg;
          if (!filePaths?.length || !zipPath) break;
          this._panel.webview.postMessage({ command: 'exportProgress', phase: 'Building zip…', done: 0, total: filePaths.length });
          try {
            await this._engine.exportLowResZip(filePaths, zipPath, { maxLongEdge: 1500, quality: 80 }, (done, total, name) => {
              this._panel?.webview.postMessage({ command: 'exportProgress', phase: `Resizing ${name}`, done, total });
            });
            vscode.window.showInformationMessage(`Zip saved to ${zipPath}`);
            this._panel?.webview.postMessage({ command: 'exportDone', success: true });
          } catch (e) {
            vscode.window.showErrorMessage(`Zip failed: ${e}`);
            this._panel?.webview.postMessage({ command: 'exportDone', success: false, error: String(e) });
          }
          break;
        }
      }
    });
  }

  // ── private ──────────────────────────────────────────────────────────────────

  async _sendTimeline() {
    const tl = await this._scanner.getTimeline();
    const years = Object.keys(tl).sort((a, b) => Number(b) - Number(a)).map(y => ({
      year:   y,
      months: Object.keys(tl[y]).sort((a, b) => Number(b) - Number(a)).map(m => ({
        month: m,
        count: tl[y][m].length,
        files: tl[y][m].map(f => f.path),
      })),
    }));
    this._panel?.webview.postMessage({ command: 'timeline', years });
  }

  /** @param {vscode.Webview} webview */
  _buildHtml(webview) {
    const nonce     = getNonce();
    const sharedDir = path.join(this._ctx.extensionPath, 'webviews', 'shared');
    const sharedCss = fs.readFileSync(path.join(sharedDir, 'styles.css'), 'utf-8');
    const sharedJs  = fs.readFileSync(path.join(sharedDir, 'components.js'), 'utf-8');
    const html = fs.readFileSync(
      path.join(this._ctx.extensionPath, 'webviews', 'export-panel.html'), 'utf-8'
    );
    return html
      .replace('/* __SHARED_CSS__ */', sharedCss)
      .replace('/* __SHARED_JS__ */', sharedJs)
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{cspSource\}\}/g, webview.cspSource);
  }
}

module.exports = ExportPanelProvider;
