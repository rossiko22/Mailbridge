import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenVault } from '../src/security/token-vault.js';

test('credentials round-trip and are bound to their account', () => {
    const sealed = tokenVault('secret', 'account-1').encrypt('{"refresh":"abc"}');
    assert.equal(tokenVault('secret', 'account-1').decrypt(sealed), '{"refresh":"abc"}');
    assert.throws(() => tokenVault('secret', 'account-2').decrypt(sealed));
    assert.throws(() => tokenVault('other', 'account-1').decrypt(sealed));
    assert.notEqual(tokenVault('secret', 'account-1').encrypt('x'), tokenVault('secret', 'account-1').encrypt('x'));
});
test('malformed ciphertext is rejected', () => {
    assert.throws(() => tokenVault('secret', 'a').decrypt('nonsense'));
});
test('a shortened authentication tag is rejected', () => {
    const [iv, tag, data] = tokenVault('secret', 'a').encrypt('value').split('.');
    const short = Buffer.from(tag!, 'base64').subarray(0, 4).toString('base64');
    assert.throws(() => tokenVault('secret', 'a').decrypt([iv, short, data].join('.')), /Invalid encrypted credentials/);
});
