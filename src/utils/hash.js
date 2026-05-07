import crypto from 'crypto';

/**
 * Generates a SHA-256 hash of the given content.
 * @param {string} content - The content to hash.
 * @returns {string} The hex-encoded hash.
 */
export function generateHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}
