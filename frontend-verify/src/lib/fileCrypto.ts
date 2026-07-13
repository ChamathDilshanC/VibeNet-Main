// VibeNet — client-side file/image encryption for chat attachments.
//
// Separate from lib/e2ee.ts's conversation-level ECDH key agreement: a file
// gets its own one-off random AES-256-GCM key, independent of who it'll be
// sent to. That per-file key (plus its IV) then rides inside the normal
// encrypted message envelope — see lib/messageStore.ts's MessageFileMeta —
// which is what actually ties it to a recipient, via the exact same
// conversation/group key that already protects text messages.
//
// This module never touches the network: encryptFile hands back a ciphertext
// Blob ready to PUT to S3 (see lib/upload.ts), and decryptFile takes whatever
// bytes were fetched back from there. The unencrypted file itself never
// leaves the browser in any form other than what the person explicitly picked.

import { base64ToBuffer, bufferToBase64 } from './e2ee';

// 12 bytes is the standard/recommended AES-GCM IV length (96 bits) — same
// size used for message text in e2ee.ts.
const IV_BYTES = 12;

export interface EncryptedFile {
  /** Ciphertext, ready to upload as the S3 object body. */
  blob: Blob;
  /** Raw AES-256-GCM key, base64 — goes inside the E2EE message envelope. */
  keyB64: string;
  /** AES-GCM IV used for this file, base64 — also goes inside the envelope. */
  ivB64: string;
}

// encryptFile reads the whole file into memory, encrypts it under a freshly
// generated AES-256-GCM key, and returns the ciphertext as a Blob plus the
// key/IV needed to decrypt it later. The key is extractable (unlike the
// conversation shared key) because it has to be exported to travel inside the
// message envelope — the envelope's own encryption is what protects it.
export async function encryptFile(file: File): Promise<EncryptedFile> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = await file.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const rawKey = await crypto.subtle.exportKey('raw', key);

  return {
    blob: new Blob([ciphertext], { type: 'application/octet-stream' }),
    keyB64: bufferToBase64(rawKey),
    ivB64: bufferToBase64(iv.buffer),
  };
}

// decryptFile reverses encryptFile: given the ciphertext bytes fetched from
// S3 and the key/IV recovered from the E2EE envelope, returns the original
// file as a Blob (tagged with its real MIME type so it renders/downloads
// correctly). Throws on a tampered payload or mismatched key, same as
// e2ee.ts's decryptText.
export async function decryptFile(
  ciphertext: ArrayBuffer,
  keyB64: string,
  ivB64: string,
  mimeType: string,
): Promise<Blob> {
  const key = await crypto.subtle.importKey(
    'raw',
    base64ToBuffer(keyB64),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const iv = base64ToBuffer(ivB64);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new Blob([plaintext], { type: mimeType || 'application/octet-stream' });
}
