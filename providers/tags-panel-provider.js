// @ts-check
'use strict';

const vscode = require('vscode');
const path   = require('path');
const fs     = require('fs');
const { getNonce } = require('../lib/utils');
const { IMAGE_EXT } = require('../lib/media-scanner');

/**
 * @typedef {import('../lib/tag-store')} TagStore
 * @typedef {import('../lib/media-scanner').MediaScanner} MediaScanner
 */

class TagsPanelProvider {
  /**
   * @param {import('vscode').ExtensionContext} ctx
   * @param {TagStore} tagStore
   * @param {MediaScanner} scanner
   */
  constructor(ctx, tagStore, scanner) {
    this._ctx      = ctx;
    this._tagStore = tagStore;
    this._scanner  = scanner;
    /** @type {vscode.WebviewPanel | null} */
    this._panel = null;
  }

  async open() {
    if (this._panel) { this._panel.reveal(); await this._sendInit(); return; }

    this._panel = vscode.window.createWebviewPanel(
      'luminaryTags',
      'Manage Tags',
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
    this._panel.iconPath = new vscode.ThemeIcon('tag');
    this._panel.onDidDispose(() => { this._panel = null; });

    this._panel.webview.html = this._buildHtml(this._panel.webview);

    this._panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case 'ready':
          await this._sendInit();
          break;

        case 'renameTag': {
          const newName = await vscode.window.showInputBox({
            prompt: `Rename tag "${msg.tag}" to`,
            value:  msg.tag,
          });
          if (newName && newName.trim() && newName !== msg.tag) {
            await this._tagStore.renameTag(msg.tag, newName.trim());
            await this._sendInit();
          }
          break;
        }

        case 'deleteTag': {
          const ok = await vscode.window.showWarningMessage(
            `Delete tag "${msg.tag}" from all files?`,
            { modal: true },
            'Delete'
          );
          if (ok === 'Delete') {
            await this._tagStore.deleteTag(msg.tag);
            await this._sendInit();
          }
          break;
        }

        case 'removeTagFromFile':
          await this._tagStore.removeTag(msg.filePath, msg.tag);
          await this._sendInit();
          break;

        case 'showTagFiles': {
          // Switch to a filtered view — just re-send init with a highlighted tag
          await this._sendInit(msg.tag);
          break;
        }

        case 'exportTag':
          await vscode.commands.executeCommand('luminary.openExport', msg.filePaths);
          break;
      }
    });
  }

  // ── private ──────────────────────────────────────────────────────────────────

  /** @param {string} [highlightTag] */
  async _sendInit(highlightTag) {
    if (!this._panel) return;

    const index   = await this._tagStore.getTagIndex();
    const webview = this._panel.webview;

    // Build takenAt lookup from scanner cache (in-memory after first scan)
    const allFiles  = await this._scanner.getAllFiles();
    const takenAtMap = new Map(allFiles.map(f => [f.path, f.takenAt]));

    // Build per-tag file info
    const tags = Object.entries(index).map(([tag, filePaths]) => ({
      tag,
      count: filePaths.length,
      files: filePaths.map(fp => {
        const ext   = path.extname(fp).slice(1).toLowerCase();
        const isImg = IMAGE_EXT.has(ext);
        return {
          path:    fp,
          name:    path.basename(fp),
          ext,
          isImage: isImg,
          takenAt: takenAtMap.get(fp) || 0,
          uri:     isImg
            ? webview.asWebviewUri(vscode.Uri.file(fp)).toString()
            : null,
        };
      }),
    }));

    webview.postMessage({ command: 'init', tags, highlightTag: highlightTag || null });
  }

  /** @param {vscode.Webview} webview */
  _buildHtml(webview) {
    const nonce     = getNonce();
    const sharedDir = path.join(this._ctx.extensionPath, 'webviews', 'shared');
    const sharedCss = fs.readFileSync(path.join(sharedDir, 'styles.css'), 'utf-8');
    const sharedJs  = fs.readFileSync(path.join(sharedDir, 'components.js'), 'utf-8');
    const html = fs.readFileSync(
      path.join(this._ctx.extensionPath, 'webviews', 'tags-panel.html'), 'utf-8'
    );
    return html
      .replace('/* __SHARED_CSS__ */', sharedCss)
      .replace('/* __SHARED_JS__ */', sharedJs)
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{cspSource\}\}/g, webview.cspSource);
  }
}

module.exports = TagsPanelProvider;
