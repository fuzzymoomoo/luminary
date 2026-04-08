// @ts-check
'use strict';

const vscode = require('vscode');

/**
 * @typedef {import('../lib/media-scanner').MediaScanner} MediaScanner
 * @typedef {import('../lib/tag-store')} TagStore
 */

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

class TimelineTreeProvider {
  /**
   * @param {MediaScanner} scanner
   * @param {TagStore} tagStore
   */
  constructor(scanner, tagStore) {
    this._scanner  = scanner;
    this._tagStore = tagStore;
    this._scanProgress = { done: 0, total: 0 };

    this._onDidChangeTreeData = new vscode.EventEmitter();
    /** @type {vscode.Event<any>} */
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    // Refresh tree whenever scan finishes or tags change
    scanner.onScanDone(() => this._onDidChangeTreeData.fire(undefined));
    tagStore.onDidChange(() => this._onDidChangeTreeData.fire(undefined));

    // Show live progress during scan
    let lastRefresh = 0;
    scanner.onScanProgress(p => {
      this._scanProgress = p;
      const now = Date.now();
      if (now - lastRefresh > 500) {          // throttle to 2 fps
        lastRefresh = now;
        this._onDidChangeTreeData.fire(undefined);
      }
    });
  }

  refresh() {
    this._scanner.startBackgroundScan();
    this._onDidChangeTreeData.fire(undefined);
  }

  /** @param {any} el */
  getTreeItem(el) { return el; }

  /**
   * getChildren NEVER awaits a long operation — returns immediately.
   * @param {any} el
   * @returns {vscode.TreeItem[]}
   */
  getChildren(el) {
    if (!this._scanner.isConfigured()) {
      const i = new vscode.TreeItem('Click to set media root folder');
      i.iconPath = new vscode.ThemeIcon('folder-opened');
      i.command  = { command: 'luminary.setRootFolder', title: 'Set Root' };
      return [i];
    }

    if (!el) return this._yearItems();
    if (el._type === 'year') return this._monthItems(el._year);
    return [];
  }

  // ── private builders (synchronous — only reads cached data) ─────────────────

  _yearItems() {
    // Scanning — show live progress
    if (this._scanner.isScanning) {
      const { done, total } = this._scanProgress;
      const label = total > 0
        ? `Scanning… ${done.toLocaleString()} / ${total.toLocaleString()}`
        : 'Scanning media folder…';
      const i = new vscode.TreeItem(label);
      i.iconPath = new vscode.ThemeIcon('loading~spin');
      return [i];
    }

    const tl = this._scanner.getCachedTimeline();

    // Not yet scanned — kick it off and show spinner
    if (!tl) {
      this._scanner.startBackgroundScan();
      const i = new vscode.TreeItem('Scanning media folder…');
      i.iconPath = new vscode.ThemeIcon('loading~spin');
      return [i];
    }

    const years = Object.keys(tl).sort((a, b) => Number(b) - Number(a));
    if (!years.length) {
      const i = new vscode.TreeItem('No media files found');
      i.iconPath = new vscode.ThemeIcon('info');
      return [i];
    }

    return years.map(y => {
      const total = Object.values(tl[y]).reduce((s, a) => s + a.length, 0);
      const item  = new vscode.TreeItem(y, vscode.TreeItemCollapsibleState.Collapsed);
      item.description  = `${total.toLocaleString()} items`;
      item.iconPath     = new vscode.ThemeIcon('calendar');
      item.contextValue = 'luminaryYear';
      // @ts-ignore
      item._type = 'year';
      // @ts-ignore
      item._year = y;
      return item;
    });
  }

  /** @param {string} year */
  _monthItems(year) {
    const tl     = this._scanner.getCachedTimeline();
    const months = tl?.[year] || {};
    return Object.keys(months)
      .sort((a, b) => Number(b) - Number(a))
      .map(m => {
        const count = months[m].length;
        const item  = new vscode.TreeItem(
          MONTH_NAMES[Number(m) - 1],
          vscode.TreeItemCollapsibleState.None
        );
        item.description  = `${count.toLocaleString()} items`;
        item.iconPath     = new vscode.ThemeIcon('file-media');
        item.contextValue = 'luminaryMonth';
        item.command = {
          command:   'luminary.openMonth',
          title:     'Open',
          arguments: [year, m],
        };
        // @ts-ignore
        item._type  = 'month';
        // @ts-ignore
        item._year  = year;
        // @ts-ignore
        item._month = m;
        return item;
      });
  }
}

module.exports = TimelineTreeProvider;
