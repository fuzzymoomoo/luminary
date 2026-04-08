/**
 * face-worker.js
 *
 * Standalone Node.js worker process — NOT loaded by VS Code's Electron runtime.
 * Spawned by face-recognizer.js using the system's `node` binary so native
 * modules (@tensorflow/tfjs-node-gpu, @tensorflow/tfjs-node) load correctly.
 *
 * Protocol: newline-delimited JSON on stdin/stdout.
 *   stdin  ← { id, cmd, ...args }
 *   stdout → { id, ok: true, ...result }  |  { id, ok: false, error: string }
 *
 * All other output (TF logs, warnings, etc.) is redirected to stderr so it
 * never corrupts the JSON stream.
 */

'use strict';

// ── Node.js v22 compatibility ─────────────────────────────────────────────────
// util.isNullOrUndefined (and siblings) were removed in Node v22.
// face-api and some TF deps still reference them via compiled TypeScript.
{
  const u = require('util');
  if (!u.isNullOrUndefined)   u.isNullOrUndefined   = v => v === null || v === undefined;
  if (!u.isNull)              u.isNull              = v => v === null;
  if (!u.isUndefined)         u.isUndefined         = v => v === undefined;
  if (!u.isString)            u.isString            = v => typeof v === 'string';
  if (!u.isNumber)            u.isNumber            = v => typeof v === 'number';
  if (!u.isBoolean)           u.isBoolean           = v => typeof v === 'boolean';
  if (!u.isObject)            u.isObject            = v => typeof v === 'object' && v !== null;
  if (!u.isFunction)          u.isFunction          = v => typeof v === 'function';
  if (!u.isArray)             u.isArray             = Array.isArray;
  if (!u.isPrimitive)         u.isPrimitive         = v => v === null || (typeof v !== 'object' && typeof v !== 'function');
}

// ── Silence stdout pollution from TF/face-api logs ───────────────────────────
// Any console.log would break the JSON line protocol.
const _stderr = (...a) => process.stderr.write(a.join(' ') + '\n');
console.log   = _stderr;
console.info  = _stderr;
console.warn  = _stderr;
console.debug = _stderr;

// Suppress TF C++ core logs
process.env['TF_CPP_MIN_LOG_LEVEL'] = '3';
process.env['TF_ENABLE_DEPRECATION_WARNINGS'] = '0';

const path     = require('path');
const fs       = require('fs');
const readline = require('readline');

// ── State ────────────────────────────────────────────────────────────────────
let tf      = null;
let faceapi = null;

// ── IPC loop ─────────────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async line => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try { msg = JSON.parse(trimmed); }
  catch { return; }

  try {
    const result = await dispatch(msg);
    send(msg.id, true, result);
  } catch (e) {
    send(msg.id, false, { error: e?.message || String(e) });
  }
});

rl.on('close', () => process.exit(0));

function send(id, ok, payload) {
  process.stdout.write(JSON.stringify({ id, ok, ...payload }) + '\n');
}

// ── Command dispatch ──────────────────────────────────────────────────────────
async function dispatch(msg) {
  switch (msg.cmd) {
    case 'init':   return cmdInit();
    case 'detect': return cmdDetect(msg.imagePath);
    case 'match':  return cmdMatch(msg.imagePath, msg.labeled, msg.threshold);
    case 'crop':   return cmdCrop(msg.imagePath, msg.box);
    default: throw new Error(`Unknown command: ${msg.cmd}`);
  }
}

// ── init ──────────────────────────────────────────────────────────────────────
async function cmdInit() {
  const backends = [
    { pkg: '@tensorflow/tfjs-node-gpu', label: 'GPU (CUDA)' },
    { pkg: '@tensorflow/tfjs-node',     label: 'CPU (native)' },
    { pkg: '@tensorflow/tfjs',          label: 'CPU (JS)' },
  ];

  for (const { pkg, label } of backends) {
    try {
      // On Windows tfjs-node sets its deps/lib on PATH — do it explicitly too
      if ((pkg === '@tensorflow/tfjs-node-gpu' || pkg === '@tensorflow/tfjs-node')
          && process.platform === 'win32') {
        const pkgDir  = path.dirname(require.resolve(pkg + '/package.json'));
        const depsLib = path.join(pkgDir, 'deps', 'lib');
        if (fs.existsSync(depsLib)) {
          process.env.PATH = depsLib + path.delimiter + process.env.PATH;
        }
      }

      tf = require(pkg);
      await tf.ready();

      // Verify a real tensor operation works (catches silent GPU init failure)
      const t = tf.tensor1d([1, 2, 3]);
      t.dispose();

      // Load face-api after TF is confirmed working
      faceapi = require('@vladmandic/face-api');
      await faceapi.tf.ready();

      const modelPath = path.join(
        path.dirname(require.resolve('@vladmandic/face-api/package.json')),
        'model'
      );
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);

      return { backend: label };
    } catch (e) {
      process.stderr.write(`[face-worker] ${pkg} failed: ${e?.message}\n`);
      tf = null; faceapi = null;
    }
  }
  throw new Error('No TensorFlow backend could be loaded (tried GPU, CPU-native, CPU-JS)');
}

// ── detect ────────────────────────────────────────────────────────────────────
async function cmdDetect(imagePath) {
  assertReady();
  const tensor = loadTensor(imagePath);
  try {
    const dets = await faceapi
      .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
    return {
      detections: dets.map(d => ({
        descriptor: Array.from(d.descriptor),
        box: { x: d.detection.box.x, y: d.detection.box.y,
               width: d.detection.box.width, height: d.detection.box.height },
        score: d.detection.score,
      }))
    };
  } finally { tensor.dispose(); }
}

// ── match ─────────────────────────────────────────────────────────────────────
async function cmdMatch(imagePath, labeledRaw, threshold) {
  assertReady();
  if (!labeledRaw?.length) return { matches: [] };

  const labeled = labeledRaw.map(ld =>
    new faceapi.LabeledFaceDescriptors(
      ld.label,
      ld.descriptors.map(d => new Float32Array(d))
    )
  );

  const tensor = loadTensor(imagePath);
  try {
    const dets = await faceapi
      .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (!dets.length) return { matches: [] };

    const matcher = new faceapi.FaceMatcher(labeled, threshold);
    const best    = new Map();
    for (const det of dets) {
      const r = matcher.findBestMatch(det.descriptor);
      if (r.label !== 'unknown') {
        const prev = best.get(r.label) ?? Infinity;
        if (r.distance < prev) best.set(r.label, r.distance);
      }
    }
    return { matches: [...best.entries()].map(([personName, distance]) => ({ personName, distance })) };
  } finally { tensor.dispose(); }
}

// ── crop ──────────────────────────────────────────────────────────────────────
async function cmdCrop(imagePath, box) {
  assertReady();
  const buf  = fs.readFileSync(imagePath);
  const src  = tf.node.decodeImage(buf, 3);  // uint8 [H, W, 3]
  try {
    const [imgH, imgW] = src.shape;
    const pad  = Math.round(Math.max(box.width, box.height) * 0.35);
    const x    = Math.max(0, Math.round(box.x - pad));
    const y    = Math.max(0, Math.round(box.y - pad));
    const w    = Math.min(imgW - x, Math.round(box.width + pad * 2));
    const h    = Math.min(imgH - y, Math.round(box.height + pad * 2));

    // cropAndResize expects float32 [0,1] with batch dim
    const f       = src.toFloat().div(255).expandDims(0);
    const boxes   = tf.tensor2d([[y / imgH, x / imgW, (y + h) / imgH, (x + w) / imgW]]);
    const ids     = tf.tensor1d([0], 'int32');
    const cropped = tf.image.cropAndResize(f, boxes, ids, [160, 160]); // [1,160,160,3]
    const uint8   = cropped.squeeze(0).mul(255).round().toInt();        // [160,160,3]
    const bytes   = await tf.node.encodeJpeg(uint8, 'rgb', 80);

    tf.dispose([f, boxes, ids, cropped, uint8]);
    return { thumb: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}` };
  } finally {
    src.dispose();
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
function assertReady() {
  if (!tf || !faceapi) throw new Error('Worker not initialised — send "init" first');
}

function loadTensor(imagePath) {
  const buf = fs.readFileSync(imagePath);
  return tf.node.decodeImage(buf, 3);
}
