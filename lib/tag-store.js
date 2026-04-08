// @ts-check
'use strict';

const fs  = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const vscode = require('vscode');

/**
 * @typedef {{ [filePath: string]: string[] }} TagData
 */

class TagStore {
  /**
   * @param {() => string} getRootFolder
   */
  constructor(getRootFolder) {
    this._getRootFolder = getRootFolder;
    /** @type {TagData | null} */
    this._data = null;

    this._onDidChange = new vscode.EventEmitter();
    /** @type {vscode.Event<void>} */
    this.onDidChange = this._onDidChange.event;
  }

  get tagsPath() {
    const r = this._getRootFolder();
    return r ? path.join(r, '.luminary', 'tags.json') : null;
  }

  // ── internal ─────────────────────────────────────────────────────────────────

  /** @returns {Promise<TagData>} */
  async _load() {
    if (this._data) return this._data;
    const tp = this.tagsPath;
    if (!tp || !fs.existsSync(tp)) { this._data = {}; return this._data; }
    try { this._data = JSON.parse(await fsp.readFile(tp, 'utf-8')); }
    catch { this._data = {}; }
    return /** @type {TagData} */ (this._data);
  }

  async _save() {
    const tp = this.tagsPath;
    if (!tp) return;
    await fsp.mkdir(path.dirname(tp), { recursive: true });
    await fsp.writeFile(tp, JSON.stringify(this._data, null, 2), 'utf-8');
    this._onDidChange.fire();
  }

  // ── public API ───────────────────────────────────────────────────────────────

  /** @param {string} filePath @returns {Promise<string[]>} */
  async getTags(filePath) {
    return (await this._load())[filePath] || [];
  }

  /**
   * Return a map of filePath → tags for a batch of paths.
   * Single load — much faster than calling getTags() per file.
   * @param {string[]} filePaths
   * @returns {Promise<{ [filePath: string]: string[] }>}
   */
  async getTagsForFiles(filePaths) {
    const data = await this._load();
    /** @type {{ [filePath: string]: string[] }} */
    const result = {};
    for (const fp of filePaths) result[fp] = data[fp] || [];
    return result;
  }

  /** @returns {Promise<string[]>} Sorted list of all unique tag names */
  async getAllTagNames() {
    const data = await this._load();
    const set = new Set(/** @type {string[]} */(Object.values(data).flat()));
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  /** @returns {Promise<{ [tag: string]: string[] }>} tag → array of file paths */
  async getTagIndex() {
    const data = await this._load();
    /** @type {{ [tag: string]: string[] }} */
    const idx = {};
    for (const [fp, tags] of Object.entries(data)) {
      for (const t of tags) {
        if (!idx[t]) idx[t] = [];
        idx[t].push(fp);
      }
    }
    return idx;
  }

  /**
   * @param {string} filePath
   * @param {string} tag
   */
  async addTag(filePath, tag) {
    const data = await this._load();
    if (!data[filePath]) data[filePath] = [];
    if (!data[filePath].includes(tag)) { data[filePath].push(tag); await this._save(); }
  }

  /**
   * @param {string} filePath
   * @param {string} tag
   */
  async removeTag(filePath, tag) {
    const data = await this._load();
    if (!data[filePath]) return;
    data[filePath] = data[filePath].filter(t => t !== tag);
    if (!data[filePath].length) delete data[filePath];
    await this._save();
  }

  /**
   * Replace the full tag list for a file.
   * @param {string} filePath
   * @param {string[]} tags
   */
  async setTags(filePath, tags) {
    const data = await this._load();
    if (tags.length === 0) delete data[filePath];
    else data[filePath] = tags;
    await this._save();
  }

  /**
   * Add a tag to multiple files at once.
   * @param {string[]} filePaths
   * @param {string} tag
   */
  async addTagToMany(filePaths, tag) {
    const data = await this._load();
    for (const fp of filePaths) {
      if (!data[fp]) data[fp] = [];
      if (!data[fp].includes(tag)) data[fp].push(tag);
    }
    await this._save();
  }

  /**
   * @param {string} oldName
   * @param {string} newName
   */
  async renameTag(oldName, newName) {
    const data = await this._load();
    let changed = false;
    for (const tags of Object.values(data)) {
      const i = tags.indexOf(oldName);
      if (i !== -1) { tags[i] = newName; changed = true; }
    }
    if (changed) await this._save();
  }

  /** @param {string} tagName */
  async deleteTag(tagName) {
    const data = await this._load();
    let changed = false;
    for (const [fp, tags] of Object.entries(data)) {
      const next = tags.filter(t => t !== tagName);
      if (next.length !== tags.length) {
        changed = true;
        if (!next.length) delete data[fp];
        else data[fp] = next;
      }
    }
    if (changed) await this._save();
  }

  dispose() { this._onDidChange.dispose(); }
}

module.exports = TagStore;
