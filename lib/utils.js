// @ts-check
'use strict';

const crypto = require('crypto');

/** @returns {string} */
function getNonce() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { getNonce };
