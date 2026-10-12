import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayUseProvider } from '../src/modules/accounts/accounts.routes.js';

test('Outlook is open to everyone', () => assert.equal(mayUseProvider(['a@x.com'], 'outlook', 'b@y.com'), true));
test('an empty Gmail list means everyone', () => assert.equal(mayUseProvider([], 'gmail', 'b@y.com'), true));
test('Gmail is limited to the invited emails, ignoring case and spaces', () => {
    assert.equal(mayUseProvider(['a@x.com'], 'gmail', ' A@X.com '), true);
    assert.equal(mayUseProvider(['a@x.com'], 'gmail', 'b@y.com'), false);
});
