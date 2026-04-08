// @ts-check
'use strict';

const fs = require('fs');

/**
 * Extract the capture date from a JPEG file's EXIF data.
 * Pure Node.js — no external dependencies.
 * Returns a Date or null if not found / not a JPEG.
 *
 * @param {string} filePath
 * @returns {Date | null}
 */
function readExifDate(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(65536);
    const bytesRead = fs.readSync(fd, buf, 0, 65536, 0);
    if (bytesRead < 4) return null;

    // Must start with JPEG magic FF D8
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;

    // Walk JPEG segments looking for APP1 (FF E1)
    let offset = 2;
    while (offset + 4 <= bytesRead) {
      if (buf[offset] !== 0xFF) break;
      const marker = buf[offset + 1];
      if (offset + 3 >= bytesRead) break;
      const segLen = buf.readUInt16BE(offset + 2);

      if (marker === 0xE1 && offset + 10 <= bytesRead) {
        // Check for "Exif\0\0" header
        if (buf.toString('ascii', offset + 4, offset + 8) === 'Exif') {
          const tiffStart = offset + 10;
          const date = _parseTiff(buf, tiffStart, bytesRead);
          if (date) return date;
        }
      }

      // Skip to next segment (0xFF marker + 2-byte length includes the length bytes themselves)
      if (marker === 0xDA) break; // Start of scan data — stop
      offset += 2 + segLen;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

/**
 * @param {Buffer} buf
 * @param {number} start  - offset of the TIFF header within buf
 * @param {number} limit  - don't read beyond this offset
 * @returns {Date | null}
 */
function _parseTiff(buf, start, limit) {
  if (start + 8 > limit) return null;

  const order = buf.toString('ascii', start, start + 2);
  const le = order === 'II'; // little-endian

  /** @param {number} o @returns {number} */
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  /** @param {number} o @returns {number} */
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));

  if (u16(start + 2) !== 42) return null; // TIFF magic

  const ifd0Abs = start + u32(start + 4);
  if (ifd0Abs + 2 > limit) return null;

  const ifd0Count = u16(ifd0Abs);
  let exifSubOffset = 0;
  let ifd0DateOffset = 0;

  for (let i = 0; i < ifd0Count; i++) {
    const e = ifd0Abs + 2 + i * 12;
    if (e + 12 > limit) break;
    const tag = u16(e);
    if (tag === 0x8769) exifSubOffset = u32(e + 8);  // ExifIFD pointer
    if (tag === 0x0132) ifd0DateOffset = u32(e + 8); // DateTime
  }

  // Prefer DateTimeOriginal (0x9003) from ExifSubIFD
  if (exifSubOffset) {
    const subAbs = start + exifSubOffset;
    if (subAbs + 2 <= limit) {
      const subCount = u16(subAbs);
      for (let i = 0; i < subCount; i++) {
        const e = subAbs + 2 + i * 12;
        if (e + 12 > limit) break;
        const tag = u16(e);
        if (tag === 0x9003 || tag === 0x9004) { // DateTimeOriginal or DateTimeDigitized
          const valOff = u32(e + 8);
          const date = _parseExifDateStr(buf, start + valOff, limit);
          if (date) return date;
        }
      }
    }
  }

  // Fallback: IFD0 DateTime
  if (ifd0DateOffset) {
    return _parseExifDateStr(buf, start + ifd0DateOffset, limit);
  }

  return null;
}

/**
 * Parse an EXIF date string "YYYY:MM:DD HH:MM:SS" at the given buffer offset.
 * @param {Buffer} buf
 * @param {number} offset
 * @param {number} limit
 * @returns {Date | null}
 */
function _parseExifDateStr(buf, offset, limit) {
  if (offset + 19 > limit) return null;
  const s = buf.toString('ascii', offset, offset + 19);
  const year  = parseInt(s.slice(0, 4), 10);
  const month = parseInt(s.slice(5, 7), 10) - 1;
  const day   = parseInt(s.slice(8, 10), 10);
  const hour  = parseInt(s.slice(11, 13), 10);
  const min   = parseInt(s.slice(14, 16), 10);
  const sec   = parseInt(s.slice(17, 19), 10);
  if (isNaN(year) || year < 1970 || year > 2100) return null;
  const d = new Date(year, month, day, hour, min, sec);
  return isNaN(d.getTime()) ? null : d;
}

module.exports = { readExifDate };
