// @ts-check
'use strict';

const vscode = require('vscode');
const path   = require('path');
const fs     = require('fs');
const { getNonce }  = require('../lib/utils');
const { IMAGE_EXT } = require('../lib/media-scanner');

/**
 * @typedef {import('../lib/media-scanner').MediaScanner} MediaScanner
 * @typedef {import('../lib/tag-store')} TagStore
 * @typedef {import('../lib/people-store')} PeopleStore
 * @typedef {import('../lib/people-store').PersonRecord} PersonRecord
 */

class FaceIdProvider {
  /**
   * @param {import('vscode').ExtensionContext} ctx
   * @param {MediaScanner} scanner
   * @param {TagStore} tagStore
   * @param {PeopleStore} peopleStore
   */
  constructor(ctx, scanner, tagStore, peopleStore) {
    this._ctx         = ctx;
    this._scanner     = scanner;
    this._tagStore    = tagStore;
    this._peopleStore = peopleStore;
    /** @type {vscode.WebviewPanel | null} */
    this._panel     = null;
    this._scanAbort = false;
  }

  async open() {
    if (this._panel) { this._panel.reveal(); return; }

    this._panel = vscode.window.createWebviewPanel(
      'luminaryFaceId',
      'Face ID',
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
    this._panel.iconPath = new vscode.ThemeIcon('person');
    this._panel.onDidDispose(() => { this._panel = null; this._scanAbort = true; });
    this._panel.webview.html = this._buildHtml(this._panel.webview);

    this._panel.webview.onDidReceiveMessage(async msg => {
      switch (msg.command) {
        case 'ready':
          this._initRecognizer(); // fire-and-forget — sends initStatus when done
          await this._sendLibraryYears();
          await this._sendPeople();
          break;

        case 'createPerson':
          try {
            await this._peopleStore.create(msg.name);
            await this._sendPeople();
          } catch (e) {
            this._send({ command: 'error', message: String(e) });
          }
          break;

        case 'deletePerson':
          await this._peopleStore.deletePerson(msg.name);
          await this._sendPeople();
          break;

        case 'getLibraryYearPhotos': {
          const tl       = await this._scanner.getTimeline();
          const yearData = tl[msg.year] || {};
          const months   = Object.entries(yearData)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([month, files]) => ({
              month,
              photos: files
                .filter(f => IMAGE_EXT.has(f.ext))
                .map(f => ({
                  path: f.path,
                  name: path.basename(f.path),
                  year: msg.year,
                  uri:  this._panel?.webview
                    .asWebviewUri(vscode.Uri.file(f.path)).toString(),
                })),
            }))
            .filter(m => m.photos.length > 0);
          this._send({ command: 'libraryYearPhotos', year: msg.year, months });
          break;
        }

        case 'enrollFromLibrary':
          // msg.personName, msg.photos: [{ path, year, ... }]
          await this._enrollPhotos(msg.personName, msg.photos);
          break;

        case 'removeEnrollment':
          await this._peopleStore.removeEnrollment(msg.name, msg.year, msg.idx);
          await this._sendPeople();
          break;

        case 'scan':
          await this._runScan(msg.personName, msg.threshold ?? 0.45, msg.yearFrom, msg.yearTo);
          break;

        case 'abortScan':
          this._scanAbort = true;
          break;
      }
    });
  }

  // ── Recognizer init ───────────────────────────────────────────────────────────

  async _initRecognizer() {
    this._send({ command: 'initStatus', status: 'loading' });
    try {
      const recognizer = require('../lib/face-recognizer');
      const backend    = await recognizer.init();
      this._send({ command: 'initStatus', status: 'ready', backend });
    } catch (e) {
      this._send({ command: 'initStatus', status: 'error', message: String(e) });
    }
  }

  async _sendLibraryYears() {
    const tl    = await this._scanner.getTimeline();
    const years = Object.keys(tl).sort((a, b) => Number(b) - Number(a));
    this._send({ command: 'libraryYears', years });
  }

  // ── Enrolment ─────────────────────────────────────────────────────────────────

  /**
   * @param {string} personName
   * @param {{ path: string, year: string }[]} photos
   */
  async _enrollPhotos(personName, photos) {
    const recognizer = require('../lib/face-recognizer');
    if (!recognizer.isReady) {
      this._send({ command: 'error', message: 'Face recognizer not ready — wait for models to load' });
      return;
    }

    this._send({ command: 'enrollStart', total: photos.length });

    for (let i = 0; i < photos.length; i++) {
      const { path: imgPath, year } = photos[i];
      const name = path.basename(imgPath);
      this._send({ command: 'enrollProgress', done: i + 1, total: photos.length, file: name });

      try {
        const detections = await recognizer.detectFaces(imgPath);
        if (!detections.length) {
          this._send({ command: 'enrollResult', file: name, status: 'no-face' });
          continue;
        }
        const best  = detections.reduce((a, b) => a.score > b.score ? a : b);
        const thumb = await recognizer.cropFaceThumb(imgPath, best.box);
        await this._peopleStore.addEnrollment(personName, imgPath, best.descriptor, thumb, year);
        this._send({ command: 'enrollResult', file: name, status: 'ok', thumb });
      } catch (e) {
        const errMsg = String(e);
        this._send({ command: 'enrollResult', file: name, status: 'error', message: errMsg });
        vscode.window.showErrorMessage(`Face enroll failed for ${name}: ${errMsg}`);
      }
    }

    this._send({ command: 'enrollDone' });
    await this._sendPeople();
  }

  // ── Scan ─────────────────────────────────────────────────────────────────────

  /**
   * @param {string} personName
   * @param {number} threshold
   * @param {number|undefined} yearFrom
   * @param {number|undefined} yearTo
   */
  async _runScan(personName, threshold, yearFrom, yearTo) {
    const recognizer = require('../lib/face-recognizer');
    if (!recognizer.isReady) {
      this._send({ command: 'error', message: 'Face recognizer is not ready' });
      return;
    }

    const people = await this._peopleStore.list();
    const person = people.find(p => p.name === personName);
    const totalDescs = Object.values(person?.yearSamples || {})
      .reduce((n, s) => n + s.descriptors.length, 0);
    if (!totalDescs) {
      this._send({ command: 'error', message: `No reference photos enrolled for "${personName}"` });
      return;
    }

    // Union descriptor set per person — fallback for years with no specific samples
    /** @type {Map<string, number[][]>} */
    const unionDescriptors = new Map();
    for (const p of people) {
      const all = this._peopleStore.getUnionDescriptors(p);
      if (all.length) unionDescriptors.set(p.name, all);
    }

    // Candidate files
    let files = (await this._scanner.getAllFiles()).filter(f => IMAGE_EXT.has(f.ext));
    if (yearFrom) files = files.filter(f => new Date(f.takenAt).getFullYear() >= yearFrom);
    if (yearTo)   files = files.filter(f => new Date(f.takenAt).getFullYear() <= yearTo);

    const toScan    = files.filter(f => !f.faces || f.faces[personName] === undefined);
    const prevFound = files.filter(f => f.faces?.[personName] === true).length;

    this._scanAbort = false;
    this._send({ command: 'scanStart', total: toScan.length, prevFound, personName });

    let found = prevFound;
    let done  = 0;
    const t0  = Date.now();

    // Group by year so we use year-specific reference descriptors
    /** @type {Map<string, typeof toScan>} */
    const byYear = new Map();
    for (const file of toScan) {
      const year = String(new Date(file.takenAt).getFullYear());
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(file);
    }

    for (const [year, yearFiles] of byYear) {
      if (this._scanAbort) break;

      // Year-specific descriptors if available, otherwise fall back to union
      const labeled = people
        .map(p => {
          const yrDescs = p.yearSamples?.[year]?.descriptors;
          const descs   = (yrDescs?.length ? yrDescs : unionDescriptors.get(p.name)) || [];
          return { label: p.name, descriptors: descs };
        })
        .filter(l => l.descriptors.length > 0);

      if (!labeled.length) { done += yearFiles.length; continue; }

      for (const file of yearFiles) {
        if (this._scanAbort) break;

        try {
          const matches = await recognizer.findMatches(file.path, labeled, threshold);

          if (!file.faces) file.faces = {};
          for (const p of people) {
            if (file.faces[p.name] === undefined) file.faces[p.name] = false;
          }
          for (const { personName: matched } of matches) {
            file.faces[matched] = true;
          }

          for (const { personName: matched } of matches) {
            await this._tagStore.addTag(file.path, matched);
            if (matched === personName) {
              found++;
              const uri = this._panel?.webview
                .asWebviewUri(vscode.Uri.file(file.path)).toString() ?? null;
              this._send({ command: 'scanMatch', filePath: file.path, uri });
            }
          }
        } catch { /* unreadable / unsupported image — skip */ }

        done++;
        if (done % 20 === 0) {
          await this._scanner.saveCacheUpdates();
          const elapsed   = (Date.now() - t0) / 1000;
          const rate      = done / elapsed;
          const remaining = Math.round((toScan.length - done) / Math.max(rate, 0.01));
          this._send({ command: 'scanProgress', done, total: toScan.length, found, rate: rate.toFixed(1), remaining });
        }
      }
    }

    await this._scanner.saveCacheUpdates();
    if (this._scanAbort) {
      this._send({ command: 'scanAborted', found, done });
    } else {
      this._send({ command: 'scanDone', found, done, total: toScan.length });
    }
    await this._sendPeople();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  async _sendPeople() {
    const people = await this._peopleStore.list();
    this._send({ command: 'people', people });
  }

  /** @param {any} msg */
  _send(msg) { this._panel?.webview.postMessage(msg); }

  /** @param {vscode.Webview} webview */
  _buildHtml(webview) {
    const nonce     = getNonce();
    const sharedDir = path.join(this._ctx.extensionPath, 'webviews', 'shared');
    const sharedCss = fs.readFileSync(path.join(sharedDir, 'styles.css'), 'utf-8');
    const sharedJs  = fs.readFileSync(path.join(sharedDir, 'components.js'), 'utf-8');
    const html = fs.readFileSync(
      path.join(this._ctx.extensionPath, 'webviews', 'face-id.html'), 'utf-8'
    );
    return html
      .replace('/* __SHARED_CSS__ */', sharedCss)
      .replace('/* __SHARED_JS__ */', sharedJs)
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{cspSource\}\}/g, webview.cspSource);
  }
}

module.exports = FaceIdProvider;
