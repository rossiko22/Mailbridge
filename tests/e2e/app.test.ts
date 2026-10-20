import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { type Browser, type BrowserContext, chromium, firefox, type Page } from 'playwright';
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemoData } from '../../src/scripts/demo-data.js';
import { startApp, type TestApp } from '../support/harness.js';

// Set SCREENSHOT_DIR to keep pictures of each screen (used for the README).
const shots = process.env.SCREENSHOT_DIR;
// E2E_BROWSER=firefox runs the same tests in Firefox; Chromium otherwise.
const engine = process.env.E2E_BROWSER === 'firefox' ? firefox : chromium;

let app: TestApp;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let problems: string[];

before(async () => {
    app = await startApp();
    browser = await engine.launch();
    if (shots) await mkdir(shots, { recursive: true });
});
beforeEach(async () => {
    await app.reset();
    await seedDemoData(app.pool);
    await newPage({ width: 1280, height: 800 });
});
afterEach(async () => {
    await context?.close();
    // A blocked script, a Content-Security-Policy violation or an uncaught error fails the test that caused it.
    assert.deepEqual(problems, []);
});
after(async () => {
    await browser?.close();
    await app?.close();
});

async function newPage(viewport: { width: number; height: number }, colorScheme: 'light' | 'dark' = 'light') {
    await context?.close();
    context = await browser.newContext({ baseURL: app.url, viewport, colorScheme, deviceScaleFactor: shots ? 2 : 1 });
    context.setDefaultTimeout(10_000);
    page = await context.newPage();
    problems = [];
    // Every browser reports a blocked script or style through this event, so CSP violations fail the test everywhere.
    await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', event =>
            console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || 'inline code'}`),
        );
    });
    page.on('pageerror', error => problems.push(`page error: ${error.message}`));
    page.on('console', message => {
        if (message.type() === 'error' && !/status of 40[01]/.test(message.text())) problems.push(`console: ${message.text()}`);
    });
    page.on('response', response => {
        if (response.status() >= 500) problems.push(`${response.status()} ${response.url()}`);
    });
}
async function signIn(password = DEMO_PASSWORD) {
    await page.goto('/');
    await page.fill('#email', DEMO_EMAIL);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
}
async function openInbox() {
    await signIn();
    await page.waitForURL('**/app.html');
    await page.waitForSelector('#message-list .msg');
}
const shot = async (name: string) => {
    if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};
const rows = () => page.locator('#message-list .msg');
const noSideScroll = async (label: string) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${label}: no horizontal scrolling (${overflow}px too wide)`);
};
// Presses Tab (or Shift+Tab) until the focused element matches, like a keyboard user looking for a control.
async function tabTo(selector: string, { backwards = false, limit = 40 } = {}) {
    for (let step = 0; step < limit; step++) {
        await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
        if (await page.evaluate(target => document.activeElement?.matches(target) ?? false, selector)) return;
    }
    assert.fail(`${selector} cannot be reached with the ${backwards ? 'Shift+Tab' : 'Tab'} key`);
}

test('signing in opens the combined inbox with every mailbox', async () => {
    await page.goto('/');
    await page.waitForSelector('#email');
    await shot('sign-in');
    await openInbox();
    assert.equal(await rows().count(), 13);
    assert.equal(await page.locator('#account-list .nav-item--account').count(), 2);
    assert.equal(await page.textContent('#list-title'), 'All mail');
    assert.equal((await page.textContent('[data-total]'))?.trim(), '6');
    assert.equal(await page.title(), 'Mail · Mailbridge');
    await shot('inbox');
});
test('a wrong password shows an error and keeps the person on the sign-in page', async () => {
    await signIn('not-the-password');
    await page.waitForSelector('#form-message:not([hidden])');
    assert.match((await page.textContent('#form-message')) ?? '', /Invalid email or password/);
    assert.ok(page.url().endsWith('/'));
});
test('a signed-out visitor is sent from the app to the sign-in page', async () => {
    await page.goto('/app.html');
    await page.waitForURL('**/index.html');
    assert.equal(await page.title(), 'Sign in · Mailbridge');
});
test('opening a message shows it in a script-free frame and marks it read', async () => {
    await openInbox();
    const first = rows().first();
    assert.match((await first.getAttribute('class')) ?? '', /msg--unread/);
    await first.click();
    assert.equal(await page.textContent('.reader-subject'), 'Q4 roadmap review — slides attached');
    const frame = page.locator('.reader-frame iframe');
    assert.ok(!(await frame.getAttribute('sandbox'))?.includes('allow-scripts'));
    await page.frameLocator('.reader-frame iframe').getByText('roadmap deck').waitFor();
    await page.waitForFunction(() => !document.querySelector('#message-list .msg')?.classList.contains('msg--unread'));
    await page.waitForFunction(() => document.querySelector('[data-total]')?.textContent?.trim() === '5');
    await shot('reader');
});
test('the list can be narrowed to one mailbox, to unread mail and by search', async () => {
    await openInbox();
    await page.click('[data-filter="unread"]');
    await page.waitForFunction(() => document.querySelectorAll('#message-list .msg').length === 6);

    await page.click('[data-filter="all"]');
    await page.locator('#account-list .nav-item--account').nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll('#message-list .msg').length === 6);
    assert.match((await page.textContent('#list-title')) ?? '', /demo\.personal@gmail\.example|Personal/);

    await page.click('[data-nav="all"]');
    await page.fill('#search-input', 'boarding');
    await page.waitForFunction(() => document.querySelectorAll('#message-list .msg').length === 1);
    assert.match((await rows().first().textContent()) ?? '', /boarding pass/);
});
test('the dark theme is remembered across pages', async () => {
    await openInbox();
    assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
    await page.click('[data-theme-toggle]');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
    await rows().nth(1).click();
    await page.frameLocator('.reader-frame iframe').locator('body').waitFor();
    await shot('inbox-dark');
    await page.goto('/settings.html');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
});
test('a theme saved under the old app name is kept and moved to the new name', async () => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('ticket-mail-theme', 'dark'));
    await page.reload();
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem('mailbridge-theme'), localStorage.getItem('ticket-mail-theme')]), [
        'dark',
        null,
    ]);
});
test('settings list the connected accounts and recent activity', async () => {
    await openInbox();
    await page.goto('/settings.html');
    await page.getByText('demo.work@outlook.example').first().waitFor();
    await page.getByText('demo.personal@gmail.example').first().waitFor();
    await page.locator('#activity-list').getByText('Signed in').first().waitFor();
    assert.match((await page.locator('#activity-list .account-row small').first().textContent()) ?? '', /Chrome on \w+ · 127\.0\.0\.1/);
    await shot('settings');
    const saved = await app.pool.query('SELECT count(*)::int AS n FROM mail_accounts');
    assert.equal(saved.rows[0].n, 2);
});
test('signing out ends the session', async () => {
    await openInbox();
    await page.click('#profile-button');
    await page.click('[data-action="logout"]');
    await page.waitForURL('**/index.html');
    await page.goto('/app.html');
    await page.waitForURL('**/index.html');
    assert.equal((await app.pool.query('SELECT 1 FROM sessions')).rowCount, 0);
});
test('on a phone the list and the reader take turns', async () => {
    await newPage({ width: 390, height: 844 });
    await openInbox();
    assert.equal(await page.getAttribute('#workspace', 'data-view'), 'list');
    await shot('mobile-list');
    await rows().first().click();
    await page.waitForFunction(() => document.querySelector<HTMLElement>('#workspace')?.dataset.view === 'reader');
    await page.frameLocator('.reader-frame iframe').getByText('roadmap deck').waitFor();
    await shot('mobile-reader');
    await page.click('[data-act="back"]');
    assert.equal(await page.getAttribute('#workspace', 'data-view'), 'list');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, 'no horizontal scrolling on a narrow screen');
});

test('everything a person needs works with the keyboard alone', async () => {
    await page.goto('/');
    await tabTo('#email');
    await page.keyboard.type(DEMO_EMAIL);
    await tabTo('#password');
    await page.keyboard.type(DEMO_PASSWORD);
    await page.keyboard.press('Enter');
    await page.waitForURL('**/app.html');
    await page.waitForSelector('#message-list .msg');
    // Into the list, down to the second message, open it.
    await tabTo('#message-list .msg');
    const first = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.id);
    await page.keyboard.press('ArrowDown');
    const second = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.id);
    assert.ok(first && second && first !== second, 'the arrow key moves to the next message');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`#message-list .msg[data-id="${second}"][aria-current="true"]`);
    await page.frameLocator('.reader-frame iframe').locator('body').waitFor();
    // Search from the keyboard, then clear it with Escape.
    await tabTo('#search-input', { backwards: true });
    await page.keyboard.type('boarding');
    await page.waitForFunction(() => document.querySelectorAll('#message-list .msg').length === 1);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('#message-list .msg').length > 1);
    // Sign out through the profile menu.
    await tabTo('#profile-button', { backwards: true });
    await page.keyboard.press('Enter');
    await page.waitForSelector('#profile-menu:not([hidden])');
    await page.keyboard.press('ArrowDown');
    if (!(await page.evaluate(() => document.activeElement?.matches('[data-action="logout"]') ?? false)))
        await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/index.html');
});

test('after signing out, Back never shows the inbox again', async () => {
    await openInbox();
    await page.click('#profile-button');
    await page.click('[data-action="logout"]');
    await page.waitForURL('**/index.html');
    await page.goBack();
    // The page is not restored from the back/forward cache; it reloads, finds no session and returns to sign-in.
    await page.waitForURL('**/index.html');
    assert.equal(await rows().count(), 0);
});

test('more messages load page by page without repeats', async () => {
    const accounts = await app.pool.query<{ account_id: string }>('SELECT account_id FROM mail_accounts ORDER BY created_at LIMIT 1');
    await app.pool.query(
        `INSERT INTO emails (account_id, provider_id, subject, received_at)
        SELECT $1, 'more-' || n, 'Older message ' || n, NOW() - make_interval(days => 30 + n) FROM generate_series(1, 70) AS n`,
        [accounts.rows[0]!.account_id],
    );
    await openInbox();
    await page.waitForFunction(() => document.querySelectorAll('#message-list .msg').length === 50);
    await page.click('#more-button');
    const total = Number((await app.pool.query('SELECT count(*) FROM emails')).rows[0].count);
    await page.waitForFunction(count => document.querySelectorAll('#message-list .msg').length === count, total);
    const ids = await page.$$eval('#message-list .msg', items => items.map(item => (item as HTMLElement).dataset.id));
    assert.equal(new Set(ids).size, ids.length, 'no message is listed twice');
    assert.ok(await page.locator('#more-button').isHidden(), 'the button goes away on the last page');
});

test('no page scrolls sideways on a phone', async () => {
    await newPage({ width: 360, height: 740 });
    for (const path of ['/', '/register.html', '/forgot.html', '/reset.html']) {
        await page.goto(path);
        await noSideScroll(path);
    }
    await openInbox();
    await noSideScroll('inbox');
    await page.goto('/settings.html');
    await page.getByText('demo.work@outlook.example').first().waitFor();
    await noSideScroll('settings');
});
