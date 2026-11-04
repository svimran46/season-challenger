import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DiskBlobBackend,
  EncryptedVault,
  MemoryBlobBackend,
  openText,
  parseVaultKey,
  sealText,
} from '../src/kyc/vault';

const key = randomBytes(32);
const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(2048)]);
const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe('EncryptedVault', () => {
  it('round-trips through memory and never stores the plain bytes', async () => {
    const backend = new MemoryBlobBackend();
    const vault = new EncryptedVault(backend, key, 'memory');
    await vault.put('sub1-front', photo, 'image/jpeg');
    expect(await vault.get('sub1-front')).toEqual({ data: photo, contentType: 'image/jpeg' });
    const raw = backend.raw('sub1-front')!;
    expect(raw.includes(photo.subarray(0, 64))).toBe(false);
    expect(raw.toString('latin1')).not.toContain('image/jpeg');
    expect(await vault.get('missing')).toBeUndefined();
  });

  it('round-trips through a private directory on disk', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'kyc-vault-')), 'nested', 'docs');
    dirs.push(dir);
    const vault = new EncryptedVault(new DiskBlobBackend(dir), key, 'disk');
    await vault.put('sub1-single', photo, 'image/png');
    expect(await vault.get('sub1-single')).toEqual({ data: photo, contentType: 'image/png' });
    expect(await readdir(dir)).toEqual(['sub1-single']);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, 'sub1-single'))).mode & 0o777).toBe(0o600);
    expect((await readFile(join(dir, 'sub1-single'))).includes(photo.subarray(0, 64))).toBe(false);
    await vault.delete('sub1-single');
    expect(await vault.get('sub1-single')).toBeUndefined();
    await vault.delete('sub1-single');
  });

  it('refuses a tampered blob', async () => {
    const backend = new MemoryBlobBackend();
    const vault = new EncryptedVault(backend, key, 'memory');
    await vault.put('a', photo, 'image/jpeg');
    const raw = Buffer.from(backend.raw('a')!);
    raw[raw.length - 1]! ^= 0x01;
    backend.setRaw('a', raw);
    await expect(vault.get('a')).rejects.toThrow();
  });

  it('refuses a blob moved to another key', async () => {
    const backend = new MemoryBlobBackend();
    const vault = new EncryptedVault(backend, key, 'memory');
    await vault.put('alice-front', photo, 'image/jpeg');
    backend.setRaw('bob-front', backend.raw('alice-front')!);
    await expect(vault.get('bob-front')).rejects.toThrow();
  });

  it('refuses the wrong encryption key', async () => {
    const backend = new MemoryBlobBackend();
    await new EncryptedVault(backend, key, 'memory').put('a', photo, 'image/jpeg');
    const other = new EncryptedVault(backend, randomBytes(32), 'memory');
    await expect(other.get('a')).rejects.toThrow();
  });

  it('refuses key names that could escape the directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kyc-vault-'));
    dirs.push(dir);
    const vault = new EncryptedVault(new DiskBlobBackend(dir), key, 'disk');
    for (const bad of ['../x', 'a/b', '', '.hidden', 'a b', 'x'.repeat(129)]) {
      await expect(vault.put(bad, photo, 'image/jpeg')).rejects.toThrow(/Bad storage key/);
      await expect(vault.get(bad)).rejects.toThrow(/Bad storage key/);
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it('needs a 32-byte key', () => {
    expect(() => new EncryptedVault(new MemoryBlobBackend(), randomBytes(16), 'x')).toThrow();
  });
});

describe('parseVaultKey', () => {
  it('accepts exactly 32 bytes of base64', () => {
    expect(parseVaultKey(key.toString('base64'))).toEqual(key);
    expect(parseVaultKey(key.toString('base64url'))).toEqual(key);
    expect(() => parseVaultKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => parseVaultKey('not base64!')).toThrow();
    expect(() => parseVaultKey('')).toThrow();
  });
});

describe('sealText', () => {
  it('round-trips and refuses tampering or another key', () => {
    const sealed = sealText(key, '1234567890123');
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain('1234567890123');
    expect(sealText(key, '1234567890123')).not.toBe(sealed);
    expect(openText(key, sealed)).toBe('1234567890123');
    expect(() => openText(randomBytes(32), sealed)).toThrow();
    const bytes = Buffer.from(sealed, 'base64url');
    bytes[bytes.length - 1]! ^= 0x01;
    expect(() => openText(key, bytes.toString('base64url'))).toThrow();
  });
});
