// Client-side E2EE key handling.
//
// The backend's /api/auth/register requires a `public_key`: VibeNet is
// end-to-end encrypted, so the keypair is generated here in the browser and the
// private key never leaves the device. We generate an ECDH P-256 keypair (the
// same primitive used for key agreement), export the public key as base64 DER
// (SPKI) to send to the server, and keep the private key locally as JWK.
//
// Two accounts' ECDH keypairs let both sides independently derive the same
// AES-256-GCM symmetric key (see deriveSharedKey) — that key encrypts message
// bodies before they ever reach the WebSocket. The server only ever sees
// ciphertext + nonce.

const PRIVATE_KEY_STORAGE = 'vibenet:e2ee:privateKey';
const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' } as const;

// Exported for reuse by lib/fileCrypto.ts, which needs the exact same
// ArrayBuffer<->base64 conversion for file encryption keys/IVs — no reason to
// duplicate these two pure helpers.
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export interface GeneratedKeys {
  /** base64-encoded SPKI public key — sent to the backend. */
  publicKey: string;
  /** the private key as JWK — persisted locally, never sent. */
  privateKeyJwk: JsonWebKey;
}

// generateKeyPair creates a fresh ECDH P-256 keypair for the account.
export async function generateKeyPair(): Promise<GeneratedKeys> {
  const pair = await crypto.subtle.generateKey(ECDH_PARAMS, true, [
    'deriveKey',
    'deriveBits',
  ]);

  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

  return { publicKey: bufferToBase64(spki), privateKeyJwk };
}

// storePrivateKey persists the private key locally, namespaced by user_id so a
// device can hold keys for more than one account.
//
// Keyed by user_id rather than username on purpose: usernames are editable (see
// the profile settings page), and an account that renamed itself would otherwise
// stop finding its own key — useE2EEKeys would treat that as key loss, mint a
// fresh keypair, publish it, and leave every earlier message undecryptable.
export function storePrivateKey(userId: string, jwk: JsonWebKey): void {
  if (typeof window === 'undefined') return;
  const store = readStore();
  store[userId] = jwk;
  window.localStorage.setItem(PRIVATE_KEY_STORAGE, JSON.stringify(store));
}

// getPrivateKeyJwk returns the locally stored private key for an account, or
// null if this device has never generated (or has lost) one.
//
// `legacyUsername` migrates the entries written before this store was keyed by
// user_id: the key is moved under the user_id and the old entry dropped. Without
// it, everyone with an existing session would look like they'd lost their key.
export function getPrivateKeyJwk(userId: string, legacyUsername?: string): JsonWebKey | null {
  const store = readStore();
  const current = store[userId];
  if (current) return current;

  if (!legacyUsername) return null;
  const legacy = store[legacyUsername];
  if (!legacy) return null;

  delete store[legacyUsername];
  store[userId] = legacy;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PRIVATE_KEY_STORAGE, JSON.stringify(store));
  }
  return legacy;
}

function readStore(): Record<string, JsonWebKey> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(PRIVATE_KEY_STORAGE) ?? '{}');
  } catch {
    return {};
  }
}

// importPrivateKey turns a stored JWK back into a usable CryptoKey.
export function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, ECDH_PARAMS, false, ['deriveKey']);
}

// importPublicKey turns a peer's base64 SPKI public key (as returned by
// GET /api/users/{id}/key) into a usable CryptoKey.
export function importPublicKey(base64Spki: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', base64ToBuffer(base64Spki), ECDH_PARAMS, true, []);
}

// publicKeyB64FromPrivateJwk reconstructs the base64 SPKI public key that
// corresponds to a stored private JWK. We only persist the private key
// locally, but an EC private JWK already carries the public coordinates
// (x, y) — dropping the private scalar (d) leaves exactly the public key.
// This lets us re-publish the public half that matches whatever private key
// this device currently holds, keeping the server's copy in lockstep: if the
// two ever diverge, every message a peer encrypts to us becomes undecryptable.
export async function publicKeyB64FromPrivateJwk(jwk: JsonWebKey): Promise<string> {
  const publicJwk: JsonWebKey = {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    ext: true,
    key_ops: [],
  };
  const publicKey = await crypto.subtle.importKey('jwk', publicJwk, ECDH_PARAMS, true, []);
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  return bufferToBase64(spki);
}

// deriveSharedKey computes the AES-256-GCM key both ends of a conversation
// arrive at independently via ECDH — my private key + their public key gives
// the same result as their private key + my public key.
export function deriveSharedKey(
  myPrivateKey: CryptoKey,
  theirPublicKey: CryptoKey,
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirPublicKey },
    myPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ── Group keys ──────────────────────────────────────────────────────────────
// A group chat is encrypted under one symmetric AES-256-GCM key shared by all
// members. The creator's client generates it, then "wraps" it for each member
// by encrypting its raw bytes (as base64 text, via encryptText) under the
// pairwise ECDH key it shares with that member — the same key 1:1 chats use.
// The server stores only wrapped copies; each member unwraps locally with
// decryptText + importGroupKeyB64.

// generateGroupKeyB64 mints a fresh group key and returns its raw bytes as
// base64 — the form that gets wrapped per member and imported for use.
export async function generateGroupKeyB64(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const raw = await crypto.subtle.exportKey('raw', key);
  return bufferToBase64(raw);
}

// importGroupKeyB64 turns unwrapped raw group-key bytes (base64) back into a
// usable, non-extractable AES-GCM CryptoKey.
export function importGroupKeyB64(rawB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64ToBuffer(rawB64), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export interface EncryptedPayload {
  ciphertext: string;
  nonce: string;
}

// encryptText encrypts a plaintext message body under the conversation's
// shared key. A fresh random nonce is generated per message — AES-GCM nonces
// must never repeat under the same key.
export async function encryptText(
  sharedKey: CryptoKey,
  plaintext: string,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: bufferToBase64(ciphertext), nonce: bufferToBase64(iv.buffer) };
}

// decryptText reverses encryptText. Throws if the ciphertext/nonce/key don't
// match (tampered payload or wrong shared key).
//
// ciphertextB64/nonceB64 arrive as base64 over the wire and are decoded to
// ArrayBuffers *before* crypto.subtle.decrypt ever sees them — passing a raw
// string here would throw a TypeError at the WebCrypto API boundary, not the
// OperationError this throws on a bad tag/key, so the two failure modes are
// easy to tell apart from the error name alone.
// A pure function: it throws on any failure and logs nothing itself. Callers
// know the context (a live frame vs. re-scanning old history under a possibly
// lost key) and decide what's worth surfacing — logging here would spam one
// error per undecryptable history message on every reload.
export async function decryptText(
  sharedKey: CryptoKey,
  ciphertextB64: string,
  nonceB64: string,
): Promise<string> {
  const ivBuffer = base64ToBuffer(nonceB64);
  const ciphertextBuffer = base64ToBuffer(ciphertextB64);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    sharedKey,
    ciphertextBuffer,
  );
  return new TextDecoder().decode(plainBuf);
}
