import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { createTokenVault } from '../src/security/token-vault.js';

const current = 'current-secret-0123456789abcdefghijkl';
const old = 'old-secret-0123456789abcdefghijklmnopq';

test('credentials round-trip and are bound to their account', () => {
    const vault = createTokenVault(current);
    const sealed = vault.seal('{"refresh":"abc"}', 'account-1');
    assert.match(sealed, new RegExp(`^v2\\.${vault.keyId}\\.`));
    assert.deepEqual(vault.open(sealed, 'account-1'), { value: '{"refresh":"abc"}', stale: false });
    assert.throws(() => vault.open(sealed, 'account-2'), 'another account row cannot decrypt it');
    assert.throws(() => createTokenVault(old).open(sealed, 'account-1'), 'another key cannot decrypt it');
    assert.notEqual(vault.seal('x', 'a'), vault.seal('x', 'a'), 'each encryption uses a fresh nonce');
});

test('tampered, truncated or malformed values are rejected', () => {
    const vault = createTokenVault(current);
    const parts = vault.seal('value', 'a').split('.');
    const flip = (index: number) => {
        const copy = [...parts];
        const bytes = Buffer.from(copy[index]!, 'base64url');
        bytes[0] = bytes[0]! ^ 1;
        copy[index] = bytes.toString('base64url');
        return copy.join('.');
    };
    for (const index of [2, 3, 4]) assert.throws(() => vault.open(flip(index), 'a'), /Invalid encrypted credentials|auth/i);
    const shortTag = [...parts];
    shortTag[3] = Buffer.from(parts[3]!, 'base64url').subarray(0, 4).toString('base64url');
    assert.throws(() => vault.open(shortTag.join('.'), 'a'), /Invalid encrypted credentials/, 'a shortened GCM tag is refused');
    for (const value of ['nonsense', 'v2.unknown.a.b.c', 'v3.x.a.b.c', ''])
        assert.throws(() => vault.open(value, 'a'), /Invalid encrypted credentials/);
});

test('rotation: values sealed with the previous key still open and are reported as stale', () => {
    const sealedOld = createTokenVault(old).seal('token', 'a');
    const rotating = createTokenVault(current, old);
    assert.deepEqual(rotating.open(sealedOld, 'a'), { value: 'token', stale: true });
    assert.equal(rotating.open(rotating.seal('token', 'a'), 'a').stale, false, 'new values use the current key');
    assert.throws(() => createTokenVault(current).open(sealedOld, 'a'), 'once the previous key is removed, old values no longer open');
});

test('values from before rotation existed (v1) still open and are reported as stale', () => {
    // The original format: base64 <iv>.<tag>.<data>, key = sha256("mail-credentials-v1:" + secret).
    const key = createHash('sha256').update(`mail-credentials-v1:${current}`).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('a'));
    const data = Buffer.concat([cipher.update('legacy', 'utf8'), cipher.final()]);
    const v1 = [iv, cipher.getAuthTag(), data].map(part => part.toString('base64')).join('.');
    assert.deepEqual(createTokenVault(current).open(v1, 'a'), { value: 'legacy', stale: true });
    assert.deepEqual(createTokenVault('a-brand-new-secret-0123456789abcdefgh', current).open(v1, 'a'), { value: 'legacy', stale: true });
    assert.throws(() => createTokenVault(current).open(v1, 'b'));
});
