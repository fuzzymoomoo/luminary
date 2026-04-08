// @ts-check
'use strict';

const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');
const vscode = require('vscode');

/**
 * @typedef {{
 *   descriptors: number[][],
 *   photos:      { imagePath: string, thumb: string }[]
 * }} YearSample
 *
 * @typedef {{
 *   name:        string,
 *   color:       string,
 *   yearSamples: { [year: string]: YearSample },
 *   createdAt:   number
 * }} PersonRecord
 */

const PALETTE = [
  '#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c',
  '#3498db','#9b59b6','#e91e63','#00bcd4','#8bc34a',
];

class PeopleStore {
  /** @param {() => string} getRootFolder */
  constructor(getRootFolder) {
    this._getRootFolder = getRootFolder;
    /** @type {Map<string, PersonRecord> | null} */
    this._data = null;
    this._onDidChange = new vscode.EventEmitter();
    /** @type {vscode.Event<void>} */
    this.onDidChange = this._onDidChange.event;
  }

  get storePath() {
    const r = this._getRootFolder();
    return r ? path.join(r, '.luminary', 'people.json') : null;
  }

  /** @returns {Promise<Map<string, PersonRecord>>} */
  async _load() {
    if (this._data) return this._data;
    this._data = new Map();
    const sp = this.storePath;
    if (sp && fs.existsSync(sp)) {
      try {
        const raw = JSON.parse(await fsp.readFile(sp, 'utf-8'));
        for (const p of Object.values(raw)) {
          this._data.set(/** @type {any} */ (p).name, this._migrate(/** @type {any} */ (p)));
        }
      } catch {}
    }
    return this._data;
  }

  /** Migrate old flat schema { descriptors, enrolledPhotos } → yearSamples */
  _migrate(p) {
    if (p.yearSamples) return /** @type {PersonRecord} */ (p);
    /** @type {{ [year: string]: YearSample }} */
    const yearSamples = {};
    if (p.enrolledPhotos?.length) {
      yearSamples['legacy'] = { descriptors: p.descriptors || [], photos: p.enrolledPhotos };
    }
    return /** @type {PersonRecord} */ ({ name: p.name, color: p.color, createdAt: p.createdAt, yearSamples });
  }

  async _save() {
    const sp = this.storePath;
    if (!sp) return;
    await fsp.mkdir(path.dirname(sp), { recursive: true });
    const obj = Object.fromEntries(await this._load());
    await fsp.writeFile(sp, JSON.stringify(obj, null, 2), 'utf-8');
    this._onDidChange.fire();
  }

  /** @returns {Promise<PersonRecord[]>} */
  async list() { return [...(await this._load()).values()]; }

  /**
   * @param {string} name
   * @param {string} [color]
   */
  async create(name, color) {
    const data = await this._load();
    if (data.has(name)) throw new Error(`"${name}" already exists`);
    const person = /** @type {PersonRecord} */ ({
      name,
      color: color || PALETTE[data.size % PALETTE.length],
      yearSamples: {},
      createdAt: Date.now(),
    });
    data.set(name, person);
    await this._save();
    return person;
  }

  /** @param {string} name */
  async deletePerson(name) {
    (await this._load()).delete(name);
    await this._save();
  }

  /**
   * @param {string} name
   * @param {string} imagePath
   * @param {number[]} descriptor
   * @param {string} thumb
   * @param {string} year  e.g. "2023"
   */
  async addEnrollment(name, imagePath, descriptor, thumb, year) {
    const data   = await this._load();
    const person = data.get(name);
    if (!person) throw new Error(`Person "${name}" not found`);
    if (!person.yearSamples[year]) person.yearSamples[year] = { descriptors: [], photos: [] };
    person.yearSamples[year].descriptors.push(descriptor);
    person.yearSamples[year].photos.push({ imagePath, thumb });
    await this._save();
    return person;
  }

  /**
   * @param {string} name
   * @param {string} year
   * @param {number} idx
   */
  async removeEnrollment(name, year, idx) {
    const data   = await this._load();
    const person = data.get(name);
    if (!person?.yearSamples[year]) return;
    person.yearSamples[year].descriptors.splice(idx, 1);
    person.yearSamples[year].photos.splice(idx, 1);
    if (!person.yearSamples[year].photos.length) delete person.yearSamples[year];
    await this._save();
  }

  /**
   * Union of all descriptors across all years (used as fallback for years with no specific samples).
   * @param {PersonRecord} person
   * @returns {number[][]}
   */
  getUnionDescriptors(person) {
    return Object.values(person.yearSamples).flatMap(s => s.descriptors);
  }

  dispose() { this._onDidChange.dispose(); }
}

module.exports = PeopleStore;
