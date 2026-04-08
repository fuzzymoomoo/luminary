// @ts-check
'use strict';

const vscode = require('vscode');
const path   = require('path');
const fs     = require('fs');
const { getNonce } = require('../lib/utils');
const { IMAGE_EXT } = require('../lib/media-scanner');

/**
 * @typedef {import('../lib/media-scanner').MediaScanner} MediaScanner
 * @typedef {import('../lib/tag-store')} TagStore
 */

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

class MonthGridProvider {
  /**
   * @param {import('vscode').ExtensionContext} context
   * @param {MediaScanner} scanner
   * @param {TagStore} tagStore
   */
  constructor(context, scanner, tagStore) {
    this._ctx      = context;
    this._scanner  = scanner;
    this._tagStore = tagStore;
    /** @type {Map<string, vscode.WebviewPanel>} */
    this._panels = new Map();
  }

  /**
   * @param {string} year
   * @param {string} month
   */
  async open(year, month) {
    const key = `${year}-${month}`;
    const existing = this._panels.get(key);
    if (existing) { existing.reveal(); return; }

    const title = `${MONTH_NAMES[Number(month) - 1]} ${year}`;

    const panel = vscode.window.createWebviewPanel(
      'luminaryMonthGrid',
      title,
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
    panel.iconPath = new vscode.ThemeIcon('file-media');
    this._panels.set(key, panel);
    panel.onDidDispose(() => this._panels.delete(key));

    panel.webview.html = this._buildHtml(panel.webview);

    panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case 'ready':
          await this._sendInit(panel, year, month);
          break;

        case 'addTag': {
          // msg.tag may already be set (from the dropdown) or we prompt
          let tag = msg.tag;
          if (!tag) {
            tag = await vscode.window.showInputBox({
              prompt: 'Tag name',
              placeHolder: 'e.g. Livy',
            });
          }
          if (tag && tag.trim()) {
            await this._tagStore.addTagToMany(msg.filePaths, tag.trim());
            await this._sendInit(panel, year, month);
          }
          break;
        }

        case 'removeTag':
          await this._tagStore.removeTag(msg.filePath, msg.tag);
          await this._sendInit(panel, year, month);
          break;

        case 'openExport':
          await vscode.commands.executeCommand('luminary.openExport', msg.filePaths);
          break;

        case 'openInExplorer':
          vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.filePath));
          break;

        case 'deleteSelected': {
          const paths = msg.filePaths || [];
          if (!paths.length) break;
          const answer = await vscode.window.showWarningMessage(
            `Permanently delete ${paths.length} file${paths.length > 1 ? 's' : ''}? This cannot be undone.`,
            { modal: true },
            'Delete'
          );
          if (answer !== 'Delete') break;
          const errors = [];
          for (const filePath of paths) {
            try {
              await fs.promises.unlink(filePath);
            } catch (err) {
              errors.push(path.basename(filePath));
            }
          }
          if (errors.length) {
            vscode.window.showErrorMessage(`Could not delete: ${errors.join(', ')}`);
          }
          await this._sendInit(panel, year, month);
          break;
        }
      }
    });
  }

  // ── private ──────────────────────────────────────────────────────────────────

  /**
   * @param {vscode.WebviewPanel} panel
   * @param {string} year
   * @param {string} month
   */
  async _sendInit(panel, year, month) {
    const files   = await this._scanner.getMonthFiles(year, month);
    const allTags = await this._tagStore.getAllTagNames();

    const items = files.map(file => {
      const isImg = IMAGE_EXT.has(file.ext);
      const uri   = isImg
        ? panel.webview.asWebviewUri(vscode.Uri.file(file.path)).toString()
        : null;
      return {
        path:    file.path,
        name:    path.basename(file.path),
        ext:     file.ext,
        size:    file.size,
        takenAt: file.takenAt,
        uri,
        isImage: isImg,
      };
    });

    // Attach tags in one batch load
    const tagsMap = await this._tagStore.getTagsForFiles(items.map(i => i.path));
    const itemsWithTags = items.map(i => ({ ...i, tags: tagsMap[i.path] || [] }));

    panel.webview.postMessage({
      command:   'init',
      year,
      month,
      monthName: MONTH_NAMES[Number(month) - 1],
      items:     itemsWithTags,
      allTags,
    });
  }

  /** @param {vscode.Webview} webview */
  _buildHtml(webview) {
    const nonce     = getNonce();
    const sharedDir = path.join(this._ctx.extensionPath, 'webviews', 'shared');
    const sharedCss = fs.readFileSync(path.join(sharedDir, 'styles.css'), 'utf-8');
    const sharedJs  = fs.readFileSync(path.join(sharedDir, 'components.js'), 'utf-8');
    const html = fs.readFileSync(
      path.join(this._ctx.extensionPath, 'webviews', 'month-grid.html'), 'utf-8'
    );
    return html
      .replace('/* __SHARED_CSS__ */', sharedCss)
      .replace('/* __SHARED_JS__ */', sharedJs)
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{cspSource\}\}/g, webview.cspSource);
  }
}

module.exports = MonthGridProvider;
