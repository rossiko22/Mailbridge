import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEmail, emailCsp } from '../src/modules/emails/presentation.js';

test('Email preserves formatted tables, buttons and safe typography', () => {
    const html = renderEmail({
        contentType: 'HTML',
        content:
            '<h1 style="color:#123456;font-size:24px">Receipt</h1><table><tr><td>Total</td><td>€18</td></tr></table><a href="https://example.com?a=1&amp;b=2" style="padding:12px;background-color:#123456">Manage</a>',
    });
    assert.match(html, /<table><tr><td>Total/);
    assert.match(html, /font-size:24px/);
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
    assert.match(html, />Manage<\/a>/);
});
test('Email removes active content, local links and network-capable CSS', () => {
    const html = renderEmail({
        contentType: 'html',
        content:
            '<base href="https://evil.test"><meta http-equiv="refresh" content="0;url=https://evil.test"><style>@import "https://evil.test"</style><script>alert(1)</script><iframe src="/settings.html"></iframe><form><input></form><svg onload="alert(1)"></svg><a href="&#106;avascript:alert(1)">bad</a><a href="/auth/logout">local</a><p onclick="alert(1)" style="background-image:url(https://evil.test);position:fixed;color:red">safe</p>',
    });
    assert.doesNotMatch(html, /<script|<iframe|<form|<input|<svg|onclick|javascript:|href="\/|background-image|position:fixed|evil.test/);
    assert.match(html, /color:red/);
    assert.match(emailCsp(), /script-src 'none'/);
    assert.match(emailCsp(), /form-action 'none'/);
});
test('External images require opt-in; cid, relative and unsafe image URLs never load', () => {
    const body = {
        contentType: 'html',
        content:
            '<img src="https://images.test/logo.png" alt="Brand"><img src="cid:secret"><img src="/auth/me"><img src="data:image/svg+xml,bad"><img src="//images.test/pixel">',
    };
    const blocked = renderEmail(body);
    assert.doesNotMatch(blocked, /<img/);
    assert.match(blocked, /data-remote-images="true"/);
    assert.match(blocked, /Brand/);
    const allowed = renderEmail(body, true);
    assert.equal((allowed.match(/<img /g) || []).length, 1);
    assert.match(allowed, /referrerpolicy="no-referrer"/);
    assert.match(emailCsp(true), /img-src https:/);
});
test('Plain-text emails are escaped, with safe clickable links', () => {
    const html = renderEmail({ contentType: 'text', content: '<script>bad()</script> See https://example.com/help?a=1&b=2' });
    assert.doesNotMatch(html, /<script/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /href="https:\/\/example.com\/help\?a=1&amp;b=2"/);
});

test('Saved text hides opaque tracking URLs and strips invisible preheader padding', () => {
    const html = renderEmail({
        contentType: 'text',
        content:
            'Welcome\u200c \u200c\n[Brand] <https://track.example/click?token=secret>\nManage subscription<https://track.example/manage?token=secret>\n[https://images.example/banner.png]',
    });
    assert.match(html, />Brand<\/a>/);
    assert.match(html, />Manage subscription<\/a>/);
    assert.doesNotMatch(html, />https:\/\//);
    assert.doesNotMatch(html, /\u200c|banner.png/);
});
