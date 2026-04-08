// @ts-check
'use strict';

const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');

/**
 * Parse all HTML files in a Facebook export posts root folder.
 *
 * Returns a Map of absolute media path → Date (or null when no date found).
 * Priority: "Taken" EXIF date from table > upload/post timestamp from footer.
 *
 * @param {string} postsRoot  e.g. ".../your_facebook_activity/posts"
 * @param {(msg:string) => void} [onProgress]
 * @returns {Promise<{ dateMap: Map<string, Date|null>, htmlCount: number, noDateCount: number }>}
 */
async function parseFacebookExport(postsRoot, onProgress) {
  // FB export root is two levels above postsRoot
  // postsRoot = fbRoot/your_facebook_activity/posts
  const fbRoot = path.dirname(path.dirname(postsRoot));

  /** @type {Map<string, Date|null>} */
  const dateMap = new Map();
  let htmlCount   = 0;
  let noDateCount = 0;

  // Collect all HTML files under postsRoot (including album/ subdirectory)
  const htmlFiles = await collectHtmlFiles(postsRoot);
  htmlCount = htmlFiles.length;

  for (const htmlFile of htmlFiles) {
    if (onProgress) onProgress(`Parsing ${path.relative(postsRoot, htmlFile)}`);
    try {
      await parseHtmlFile(htmlFile, fbRoot, dateMap);
    } catch {
      // skip unreadable HTML
    }
  }

  // Count entries with no date
  for (const v of dateMap.values()) {
    if (!v) noDateCount++;
  }

  return { dateMap, htmlCount, noDateCount };
}

// ── Collect HTML files ────────────────────────────────────────────────────────

/** @param {string} dir */
async function collectHtmlFiles(dir) {
  /** @type {string[]} */
  const result = [];
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const sub = await collectHtmlFiles(full);
        result.push(...sub);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.html')) {
        result.push(full);
      }
    }
  } catch {}
  return result;
}

// ── Parse a single HTML file ──────────────────────────────────────────────────

/**
 * @param {string} htmlFile
 * @param {string} fbRoot
 * @param {Map<string, Date|null>} dateMap
 */
async function parseHtmlFile(htmlFile, fbRoot, dateMap) {
  const raw  = await fsp.readFile(htmlFile, 'utf-8');

  // Split into per-section chunks (each <section class="_a6-g"> is one post/photo)
  const parts = raw.split('<section class="_a6-g">');

  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];

    // ── Collect all media paths in this section ────────────────────────────────
    const mediaPaths = extractMediaPaths(chunk, fbRoot);
    if (!mediaPaths.length) continue;

    // ── Determine best date ────────────────────────────────────────────────────
    // 1. "Taken" EXIF date from table (most accurate — original capture time)
    const takenDate = extractTakenDate(chunk);
    // 2. Upload/post timestamp from footer (fallback)
    const uploadDate = takenDate ?? extractUploadDate(chunk);

    for (const absPath of mediaPaths) {
      // Only set if not already in map (earlier HTML files may have better data)
      if (!dateMap.has(absPath)) {
        dateMap.set(absPath, uploadDate);
      } else if (!dateMap.get(absPath) && uploadDate) {
        // Upgrade null → date if we now found one
        dateMap.set(absPath, uploadDate);
      }
    }
  }
}

// ── Extract helpers ───────────────────────────────────────────────────────────

const MEDIA_SRC_RE = /\bsrc="(your_facebook_activity\/posts\/media\/[^"]+)"/gi;

/**
 * @param {string} chunk
 * @param {string} fbRoot
 * @returns {string[]}
 */
function extractMediaPaths(chunk, fbRoot) {
  const paths = [];
  let m;
  MEDIA_SRC_RE.lastIndex = 0;
  while ((m = MEDIA_SRC_RE.exec(chunk)) !== null) {
    // Convert forward-slash URL to OS path and make absolute
    const absPath = path.join(fbRoot, ...m[1].split('/'));
    if (fs.existsSync(absPath) && !paths.includes(absPath)) {
      paths.push(absPath);
    }
  }
  return paths;
}

// Matches: >Taken</div><div><div class="_a6-q">DATE</div>
const TAKEN_RE = />Taken<\/div><div><div class="_a6-q">([^<]+)<\/div>/i;

/** @param {string} chunk @returns {Date|null} */
function extractTakenDate(chunk) {
  const m = TAKEN_RE.exec(chunk);
  if (!m) return null;
  const d = new Date(m[1].trim());
  return isNaN(d.getTime()) ? null : d;
}

// Matches: <div class="_a72d">DATE</div>
const UPLOAD_RE = /<div class="_a72d">([^<]+)<\/div>/;

/** @param {string} chunk @returns {Date|null} */
function extractUploadDate(chunk) {
  const m = UPLOAD_RE.exec(chunk);
  if (!m) return null;
  const d = new Date(m[1].trim());
  return isNaN(d.getTime()) ? null : d;
}

module.exports = { parseFacebookExport };
