import crypto from 'node:crypto';
import { config } from './config';

/** AES-256-GCM. Output format: base64(iv).base64(tag).base64(ciphertext) */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.encKey, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(blob: string): string {
  const parts = blob.split('.');
  if (parts.length !== 3) throw new Error('Malformed encrypted value');
  const [iv, tag, data] = parts.map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', config.encKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
