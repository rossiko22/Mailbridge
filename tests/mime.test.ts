import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildRawMessage,
    decodeMimeWords,
    encodeMimeWords,
    parseAddress,
    parseAddressList,
    quoteText,
    recipientLabel,
} from '../src/integrations/mail/mime.js';

test('parseAddress handles names, quotes and bare addresses', () => {
    assert.deepEqual(parseAddress('"Doe, Jane" <jane@example.com>'), { name: 'Doe, Jane', address: 'jane@example.com' });
    assert.deepEqual(parseAddress('jane@example.com'), { name: '', address: 'jane@example.com' });
    assert.deepEqual(parseAddress(undefined), { name: '', address: '' });
});
test('encoded words round-trip', () => {
    assert.equal(decodeMimeWords(encodeMimeWords('Začetek čšž')), 'Začetek čšž');
});
test('raw messages cannot be given extra headers', () => {
    const raw = buildRawMessage({ to: ['a@example.com\r\nBcc: evil@example.com'], subject: 'Hi\r\nBcc: evil@example.com', body: 'x' });
    assert.equal(raw.includes('\r\nBcc:'), false);
    assert.match(raw, /Content-Transfer-Encoding: base64/);
});
test('quoteText prefixes every line', () => assert.equal(quoteText('a\nb'), '> a\n> b'));
test('an address list splits on commas outside quotes and angle brackets', () => {
    assert.deepEqual(parseAddressList('"Doe, Jane" <jane@example.com>, bob@example.com,  <odd,one@example.com>'), [
        { name: 'Doe, Jane', address: 'jane@example.com' },
        { name: '', address: 'bob@example.com' },
        { name: '', address: 'odd,one@example.com' },
    ]);
    assert.deepEqual(parseAddressList(undefined), []);
    assert.deepEqual(parseAddressList(' , '), []);
});
test('the recipient summary prefers names and stays within 500 characters', () => {
    assert.equal(recipientLabel([{ name: 'Ann', address: 'a@x' }, { address: 'b@x' }, {}]), 'Ann, b@x');
    const long = recipientLabel(Array.from({ length: 300 }, () => ({ name: '😀😀' })));
    assert.equal([...long].length, 500);
    assert.ok(!/[\uD800-\uDBFF]$/.test(long), 'never ends in half an emoji');
});
