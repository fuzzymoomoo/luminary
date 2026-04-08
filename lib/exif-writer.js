// @ts-check
'use strict';

const fsp = require('fs/promises');

// ── EXIF date formatting ──────────────────────────────────────────────────────

/** @param {Date} date @returns {string} "YYYY:MM:DD HH:MM:SS" */
function formatExifDate(date) {
  const p = /** @param {number} n */ n => String(n).padStart(2, '0');
  return `${date.getFullYear()}:${p(date.getMonth() + 1)}:${p(date.getDate())} ` +
         `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

// ── Build a minimal EXIF APP1 segment ─────────────────────────────────────────
//
// TIFF data layout (all offsets from TIFF header start):
//   0  – 7  : TIFF header (byte order + magic + IFD0 offset)
//   8  – 37 : IFD0 (count=2, DateTime 0x0132, ExifIFD ptr 0x8769, next=0)
//   38 – 67 : ExifIFD (count=2, DateTimeOriginal 0x9003, DateTimeDigitized 0x9004, next=0)
//   68 – 87 : DateTime string (20 bytes, null-terminated)
//   88 – 107: DateTimeOriginal string (20 bytes, null-terminated)
//  108 – 127: DateTimeDigitized string (20 bytes, null-terminated)
//  Total TIFF: 128 bytes
//  Total with Exif\0\0 header (6 bytes): 134 bytes
//  APP1 segment: FF E1 + uint16BE(136) + 134 bytes = 138 bytes total

/** @param {Date} date @returns {Buffer} APP1 segment (138 bytes) */
function buildExifApp1(date) {
  const dateStr = formatExifDate(date); // 19 chars

  // Zero-filled TIFF block (128 bytes)
  const tiff = Buffer.alloc(128);

  // TIFF little-endian header
  tiff[0] = 0x49; tiff[1] = 0x49;   // 'II' — little-endian
  tiff.writeUInt16LE(42, 2);          // TIFF magic
  tiff.writeUInt32LE(8, 4);           // IFD0 at offset 8

  // IFD0 at offset 8: 2 entries
  tiff.writeUInt16LE(2, 8);
  writeEntry(tiff, 10, 0x0132, 2, 20, 68);   // DateTime → string at 68
  writeEntry(tiff, 22, 0x8769, 4, 1,  38);   // ExifIFD  → SubIFD at 38
  tiff.writeUInt32LE(0, 34);                  // no next IFD

  // ExifIFD at offset 38: 2 entries
  tiff.writeUInt16LE(2, 38);
  writeEntry(tiff, 40, 0x9003, 2, 20, 88);   // DateTimeOriginal → string at 88
  writeEntry(tiff, 52, 0x9004, 2, 20, 108);  // DateTimeDigitized → string at 108
  tiff.writeUInt32LE(0, 64);                  // no next IFD

  // Write date strings (19 chars + implicit null from Buffer.alloc)
  tiff.write(dateStr, 68,  'ascii');
  tiff.write(dateStr, 88,  'ascii');
  tiff.write(dateStr, 108, 'ascii');

  // APP1: FF E1 + length (2 + 6 + 128 = 136 BE) + Exif header + TIFF
  const exifHdr = Buffer.from('Exif\0\0', 'binary'); // 6 bytes
  const content = Buffer.concat([exifHdr, tiff]);    // 134 bytes
  const app1    = Buffer.allocUnsafe(4 + content.length);
  app1[0] = 0xFF; app1[1] = 0xE1;
  app1.writeUInt16BE(2 + content.length, 2);  // 136
  content.copy(app1, 4);
  return app1; // 138 bytes
}

/**
 * Write one 12-byte little-endian IFD entry into buf at offset off.
 * @param {Buffer} buf
 * @param {number} off
 * @param {number} tag
 * @param {number} type   2=ASCII, 4=LONG
 * @param {number} count
 * @param {number} value  offset or inline value
 */
function writeEntry(buf, off, tag, type, count, value) {
  buf.writeUInt16LE(tag,   off);
  buf.writeUInt16LE(type,  off + 2);
  buf.writeUInt32LE(count, off + 4);
  buf.writeUInt32LE(value, off + 8);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Inject a minimal EXIF block with DateTimeOriginal into a JPEG file,
 * then set the file's mtime to match.
 * If the file already has an EXIF APP1 (Exif header), only mtime is updated.
 *
 * @param {string} filePath
 * @param {Date}   date
 */
async function writeJpegDate(filePath, date) {
  const data = await fsp.readFile(filePath);

  // Must be a valid JPEG
  if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) return;

  // Scan markers to check for existing EXIF APP1
  let pos = 2;
  let hasExif = false;
  while (pos + 3 < data.length) {
    if (data[pos] !== 0xFF) break;
    const marker = data[pos + 1];
    if (marker === 0xD9 || marker === 0xDA) break; // EOI or SOS — stop

    const segLen = data.readUInt16BE(pos + 2);
    if (segLen < 2) break; // malformed

    if (marker === 0xE1 && data.length > pos + 9) {
      if (data.toString('ascii', pos + 4, pos + 8) === 'Exif') {
        hasExif = true;
        break;
      }
    }
    pos += 2 + segLen;
  }

  if (!hasExif) {
    const app1   = buildExifApp1(date);
    const output = Buffer.concat([data.slice(0, 2), app1, data.slice(2)]);
    await fsp.writeFile(filePath, output);
  }

  await fsp.utimes(filePath, date, date);
}

/**
 * Set the file's mtime (and atime) to the given date.
 * Used for non-JPEG files (MP4, MOV, PNG, etc.).
 *
 * @param {string} filePath
 * @param {Date}   date
 */
async function setFileMtime(filePath, date) {
  await fsp.utimes(filePath, date, date);
}

module.exports = { writeJpegDate, setFileMtime };
