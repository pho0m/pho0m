import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Encryption for the private copy of the content (drafts, hidden items, hidden contact details)
 * and its history. The bucket is publicly readable, so these objects are stored as AES-256-GCM
 * ciphertext; only content/site.json (the public projection) is plain JSON.
 *
 * Key: HKDF-SHA256 from the server secret (config.sessionSecret), info "pho0m-content-v1", so it
 * is separate from the token-signing use of the same secret. Changing the secret makes existing
 * envelopes unreadable (open() throws DecryptError); see GET /api/content for the fallback.
 *
 * Envelope (JSON text, every binary field base64): { "v": 1, "iv": 12 bytes, "tag": 16 bytes, "data": ciphertext }.
 * Every seal() uses a fresh random IV.
 */

export const CONTENT_KEY_INFO = "pho0m-content-v1";
export const ENVELOPE_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type Envelope = { v: 1; iv: string; tag: string; data: string };

export class DecryptError extends Error {
  override readonly name = "DecryptError";
}

/** 32-byte AES key derived from the server secret. */
export function deriveContentKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), CONTENT_KEY_INFO, 32));
}

/** Encrypt UTF-8 text into envelope JSON text. */
export function seal(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const envelope: Envelope = {
    v: ENVELOPE_VERSION,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
  return JSON.stringify(envelope);
}

const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function field(o: Record<string, unknown>, name: string, bytes?: number): Buffer {
  const value = o[name];
  if (typeof value !== "string" || !B64_RE.test(value)) throw new DecryptError(`envelope field "${name}" is not base64`);
  const buf = Buffer.from(value, "base64");
  if (bytes !== undefined && buf.byteLength !== bytes) {
    throw new DecryptError(`envelope field "${name}" must be ${bytes} bytes`);
  }
  return buf;
}

/**
 * Decrypt envelope JSON text back to the original text. Throws DecryptError when the text is
 * not a v1 envelope, or when authentication fails (wrong key, i.e. the secret changed, or tampering).
 */
export function open(key: Buffer, envelopeText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelopeText);
  } catch {
    throw new DecryptError("not an encrypted envelope (invalid JSON)");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DecryptError("not an encrypted envelope");
  }
  const o = parsed as Record<string, unknown>;
  if (o.v !== ENVELOPE_VERSION) throw new DecryptError(`unsupported envelope version ${JSON.stringify(o.v)}`);
  const iv = field(o, "iv", IV_BYTES);
  const tag = field(o, "tag", TAG_BYTES);
  const data = field(o, "data");
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new DecryptError("could not decrypt (the server secret changed, or the object was modified)");
  }
}
