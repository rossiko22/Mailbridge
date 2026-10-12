import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAvatar, MAX_AVATAR_BYTES } from '../src/modules/users/avatar.js';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const url = (type: string, data: Buffer) => `data:${type};base64,${data.toString('base64')}`;

test('accepts a real PNG data URL', () => {
    assert.equal(parseAvatar(url('image/png', png))?.contentType, 'image/png');
});
test('rejects a label that does not match the bytes', () => {
    assert.equal(parseAvatar(url('image/jpeg', png)), null);
    assert.equal(parseAvatar(url('image/png', Buffer.from('<svg onload=alert(1)>'))), null);
});
test('rejects other types, non-strings and oversized images', () => {
    assert.equal(parseAvatar(url('image/svg+xml', png)), null);
    assert.equal(parseAvatar(42), null);
    assert.equal(parseAvatar(url('image/png', Buffer.concat([png, Buffer.alloc(MAX_AVATAR_BYTES)]))), null);
});
