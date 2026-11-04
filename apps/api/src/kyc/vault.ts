import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DocumentVault } from './kyc.types';

/** Raw byte storage under a key. EncryptedVault encrypts before anything reaches it. */
export interface BlobBackend {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | undefined>;
  /** Deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
}

const KEY_NAME = /^[A-Za-z0-9_-]{1,128}$/;

function checkKey(key: string): void {
  if (!KEY_NAME.test(key)) throw new Error(`Bad storage key: ${JSON.stringify(key)}`);
}

export class MemoryBlobBackend implements BlobBackend {
  private readonly blobs = new Map<string, Buffer>();

  async put(key: string, data: Buffer) {
    checkKey(key);
    this.blobs.set(key, Buffer.from(data));
  }

  async get(key: string) {
    checkKey(key);
    const blob = this.blobs.get(key);
    return blob && Buffer.from(blob);
  }

  async delete(key: string) {
    checkKey(key);
    this.blobs.delete(key);
  }

  /** For tests: the raw stored bytes. */
  raw(key: string): Buffer | undefined {
    return this.blobs.get(key);
  }

  /** How many blobs are stored. */
  size(): number {
    return this.blobs.size;
  }

  /** For tests: overwrite the raw stored bytes. */
  setRaw(key: string, data: Buffer): void {
    this.blobs.set(key, data);
  }
}

/** One file per key in a private directory. Writes are atomic (temp file, then rename). */
export class DiskBlobBackend implements BlobBackend {
  private ready?: Promise<unknown>;

  constructor(private readonly dir: string) {}

  private ensureDir() {
    this.ready ??= mkdir(this.dir, { recursive: true, mode: 0o700 });
    return this.ready;
  }

  private path(key: string) {
    checkKey(key);
    return join(this.dir, key);
  }

  async put(key: string, data: Buffer) {
    const target = this.path(key);
    await this.ensureDir();
    const temp = join(this.dir, `.${key}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      await writeFile(temp, data, { mode: 0o600, flag: 'wx' });
      await rename(temp, target);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  async get(key: string) {
    const target = this.path(key);
    try {
      return await readFile(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async delete(key: string) {
    const target = this.path(key);
    try {
      await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Decodes a base64 vault key, which must be exactly 32 bytes (AES-256). */
export function parseVaultKey(base64: string): Buffer {
  const trimmed = base64.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) {
    throw new Error('The encryption key must be base64.');
  }
  const key = Buffer.from(trimmed, 'base64');
  if (key.length !== 32) {
    throw new Error(`The encryption key must decode to 32 bytes, got ${key.length}.`);
  }
  return key;
}

function checkAesKey(key: Buffer) {
  if (key.length !== 32) throw new Error('The encryption key must be 32 bytes.');
}

function encrypt(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

function decrypt(key: Buffer, envelope: Buffer, aad: Buffer): Buffer {
  if (envelope.length < 1 + IV_BYTES + TAG_BYTES || envelope[0] !== VERSION) {
    throw new Error('Unreadable encrypted blob.');
  }
  const iv = envelope.subarray(1, 1 + IV_BYTES);
  const tag = envelope.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  // final() throws if the blob, its key name or the encryption key do not match.
  return Buffer.concat([
    decipher.update(envelope.subarray(1 + IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]);
}

/**
 * Encrypts every object with AES-256-GCM before it reaches the backend. The storage key is the
 * additional authenticated data, so a blob copied under another key fails to decrypt.
 */
export class EncryptedVault implements DocumentVault {
  constructor(
    private readonly backend: BlobBackend,
    private readonly key: Buffer,
    readonly name: string,
  ) {
    checkAesKey(key);
  }

  async put(key: string, data: Buffer, contentType: string) {
    checkKey(key);
    const type = Buffer.from(contentType, 'utf8');
    if (type.length > 0xffff) throw new Error('Content type too long.');
    const header = Buffer.alloc(2);
    header.writeUInt16BE(type.length);
    const plaintext = Buffer.concat([header, type, data]);
    await this.backend.put(key, encrypt(this.key, plaintext, Buffer.from(key, 'utf8')));
  }

  async get(key: string) {
    checkKey(key);
    const envelope = await this.backend.get(key);
    if (!envelope) return undefined;
    const plaintext = decrypt(this.key, envelope, Buffer.from(key, 'utf8'));
    if (plaintext.length < 2) throw new Error('Unreadable encrypted blob.');
    const typeLength = plaintext.readUInt16BE(0);
    if (plaintext.length < 2 + typeLength) throw new Error('Unreadable encrypted blob.');
    return {
      contentType: plaintext.subarray(2, 2 + typeLength).toString('utf8'),
      data: Buffer.from(plaintext.subarray(2 + typeLength)),
    };
  }

  async delete(key: string) {
    checkKey(key);
    await this.backend.delete(key);
  }
}

const TEXT_AAD = Buffer.from('season-challenger:sealed-text', 'utf8');

/** Encrypts a short text (the typed document number) to a base64url string. */
export function sealText(key: Buffer, text: string): string {
  checkAesKey(key);
  return encrypt(key, Buffer.from(text, 'utf8'), TEXT_AAD).toString('base64url');
}

/** Reverses sealText; throws if the text was changed or sealed with another key. */
export function openText(key: Buffer, sealed: string): string {
  checkAesKey(key);
  return decrypt(key, Buffer.from(sealed, 'base64url'), TEXT_AAD).toString('utf8');
}
