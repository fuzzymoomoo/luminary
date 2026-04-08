// @ts-check
'use strict';

/**
 * IPC bridge to face-worker.js.
 *
 * All TensorFlow and face-api work runs in a separate child process spawned
 * with the system's `node` binary. This sidesteps the Electron-vs-Node.js
 * ABI mismatch that prevents @tensorflow/tfjs-node's native binding from
 * loading inside VS Code's extension host.
 *
 * Communication: newline-delimited JSON over stdin/stdout.
 */

const path       = require('path');
const { spawn }  = require('child_process');
const readline   = require('readline');

const WORKER_PATH = path.join(__dirname, 'face-worker.js');
const TIMEOUT_MS  = 120_000; // 2 min — model loading can be slow

class FaceRecognizer {
  constructor() {
    this._worker   = /** @type {import('child_process').ChildProcess | null} */ (null);
    this._backend  = 'none';
    this._ready    = false;
    /** @type {Promise<string> | null} */
    this._initPromise = null;
    /** @type {Map<number, { resolve: Function, reject: Function, timer: any }>} */
    this._pending  = new Map();
    this._nextId   = 1;
  }

  get backend()  { return this._backend; }
  get isReady()  { return this._ready; }

  // ── Init ──────────────────────────────────────────────────────────────────────

  /** @returns {Promise<string>} backend label */
  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._doInit();
    return this._initPromise;
  }

  async _doInit() {
    // Find `node` on PATH — the system Node.js, not Electron's
    const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node';

    this._worker = spawn(nodeExe, [WORKER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd:   path.join(__dirname, '..'), // project root so require() finds node_modules
    });

    this._worker.on('error', err => {
      this._fail(new Error(`Worker process failed to start: ${err.message}\nEnsure Node.js is installed and on PATH.`));
    });

    this._worker.on('exit', (code, signal) => {
      if (!this._ready) {
        this._fail(new Error(`Worker exited prematurely (code=${code} signal=${signal})`));
      }
      // Reject any pending calls if the worker dies unexpectedly
      for (const { reject, timer } of this._pending.values()) {
        clearTimeout(timer);
        reject(new Error('Worker process exited'));
      }
      this._pending.clear();
      this._worker  = null;
      this._ready   = false;
    });

    // Route worker's stderr to VS Code's console for debugging
    this._worker.stderr?.on('data', d => process.stderr.write(`[face-worker] ${d}`));

    // Parse JSON lines from worker stdout
    const rl = readline.createInterface({ input: this._worker.stdout, crlfDelay: Infinity });
    rl.on('line', line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg;
      try { msg = JSON.parse(trimmed); } catch { return; }
      const pending = this._pending.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this._pending.delete(msg.id);
      if (msg.ok) pending.resolve(msg);
      else        pending.reject(new Error(msg.error || 'Worker error'));
    });

    // Send init command (loads TF backend + face-api models)
    const result = await this._send({ cmd: 'init' }, TIMEOUT_MS);
    this._backend = result.backend;
    this._ready   = true;
    return this._backend;
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * @param {string} imagePath
   * @returns {Promise<{ descriptor: number[], box: object, score: number }[]>}
   */
  detectFaces(imagePath) {
    this._assertReady();
    return this._send({ cmd: 'detect', imagePath }).then(r => r.detections);
  }

  /**
   * @param {string} imagePath
   * @param {{ label: string, descriptors: number[][] }[]} labeled
   * @param {number} threshold
   * @returns {Promise<{ personName: string, distance: number }[]>}
   */
  findMatches(imagePath, labeled, threshold) {
    this._assertReady();
    return this._send({ cmd: 'match', imagePath, labeled, threshold }).then(r => r.matches);
  }

  /**
   * Build the serialisable labeled-descriptor list for findMatches.
   * (No faceapi objects — just plain data that can cross the IPC boundary.)
   * @param {{ name: string, descriptors: number[][] }[]} people
   * @returns {{ label: string, descriptors: number[][] }[]}
   */
  buildLabeledDescriptors(people) {
    return people
      .filter(p => p.descriptors.length > 0)
      .map(p => ({ label: p.name, descriptors: p.descriptors }));
  }

  /**
   * @param {string} imagePath
   * @param {{ x:number, y:number, width:number, height:number }} box
   * @returns {Promise<string>} base64 JPEG data URL
   */
  cropFaceThumb(imagePath, box) {
    this._assertReady();
    return this._send({ cmd: 'crop', imagePath, box }).then(r => r.thumb);
  }

  dispose() {
    for (const { reject, timer } of this._pending.values()) {
      clearTimeout(timer);
      reject(new Error('Recognizer disposed'));
    }
    this._pending.clear();
    if (this._worker) { this._worker.kill(); this._worker = null; }
    this._ready = false;
  }

  // ── Internal ──────────────────────────────────────────────────────────────────

  /**
   * @param {object} msg
   * @param {number} [timeoutMs]
   * @returns {Promise<any>}
   */
  _send(msg, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const id    = this._nextId++;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Worker command "${msg.cmd}" timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      this._pending.set(id, { resolve, reject, timer });
      const line = JSON.stringify({ ...msg, id }) + '\n';
      this._worker?.stdin?.write(line);
    });
  }

  /** @param {Error} err */
  _fail(err) {
    for (const { reject, timer } of this._pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    this._pending.clear();
    this._initPromise = null; // allow retry
  }

  _assertReady() {
    if (!this._ready) throw new Error('FaceRecognizer not ready — call init() first');
  }
}

module.exports = new FaceRecognizer(); // singleton
