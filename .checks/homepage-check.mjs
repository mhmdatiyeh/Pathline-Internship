import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.resolve('Task 1');
const output = path.resolve('.checks');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.ttf': 'font/ttf' };
const missing = [];
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
        missing.push(url.pathname);
        res.writeHead(404).end();
    }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${path.join(output, 'chrome-profile')}`, 'about:blank'
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
    const endpoint = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Browser startup timed out')), 20000);
        browser.on('error', reject);
        browser.stderr.on('data', data => {
            const match = data.toString().match(/DevTools listening on (ws:\/\/\S+)/);
            if (match) { clearTimeout(timer); resolve(match[1]); }
        });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0;
    const pending = new Map();
    const exceptions = [];
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.id) {
            const task = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) task.reject(new Error(JSON.stringify(message.error)));
            else task.resolve(message.result);
        }
        if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    };
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        const requestId = ++id;
        pending.set(requestId, { resolve, reject });
        socket.send(JSON.stringify({ id: requestId, method, params, sessionId }));
    });
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => call(method, params, sessionId);
    const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: base });
    for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate('document.readyState === "complete" && !!document.querySelector(".team-grid")')) break;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    await evaluate(`(async () => {
        document.querySelectorAll('img').forEach(img => img.loading = 'eager');
        await document.fonts.ready;
        await Promise.all([...document.images].map(img => img.decode()));
    })()`);
    const structure = await evaluate(`({
        title: document.title,
        h1: document.querySelectorAll('h1').length,
        sections: [...document.querySelectorAll('main > section')].map(s => s.id || s.className),
        profiles: document.querySelectorAll('.team-card').length,
        brokenImages: [...document.images].filter(i => !i.naturalWidth).map(i => i.src),
        brokenAnchors: [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(h => !document.getElementById(h.slice(1))),
        serifLoaded: document.fonts.check('40px "DM Serif Text"'),
        sansLoaded: document.fonts.check('18px "Fira Sans"')
    })`);
    assert.equal(structure.h1, 1);
    assert.equal(structure.profiles, 6);
    assert.deepEqual(structure.brokenImages, []);
    assert.deepEqual(structure.brokenAnchors, []);
    assert.ok(structure.serifLoaded && structure.sansLoaded);
    console.log(JSON.stringify(structure));

    for (const width of [1440, 1024, 768, 390, 320]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        await evaluate('window.scrollTo(0, 0); document.activeElement.blur()');
        assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `Overflow at ${width}px`);
        assert.equal(await evaluate('document.querySelector("#site-search").hidden'), true);
        await evaluate('document.querySelector(".search-toggle").click()');
        const open = await evaluate(`(() => {
            const input = document.querySelector('#site-search');
            const bounds = input.getBoundingClientRect();
            const header = document.querySelector('.site-header').getBoundingClientRect();
            return {
                hidden: input.hidden,
                focused: document.activeElement === input,
                expanded: document.querySelector('.search-toggle').getAttribute('aria-expanded'),
                inside: bounds.top >= header.top && bounds.bottom <= header.bottom && bounds.right <= header.right,
                overflow: document.documentElement.scrollWidth > innerWidth
            };
        })()`);
        assert.equal(open.hidden, false);
        assert.equal(open.focused, true);
        assert.equal(open.expanded, 'true');
        assert.equal(open.inside, true);
        assert.equal(open.overflow, false, `Expanded search overflow at ${width}px`);
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        assert.equal(await evaluate('document.querySelector("#site-search").hidden && document.activeElement === document.querySelector(".search-toggle")'), true);
        await evaluate('document.querySelector(".search-toggle").click(); document.querySelector(".hero").click()');
        assert.equal(await evaluate('document.querySelector("#site-search").hidden'), true);
        for (const index of [0, 1]) {
            await evaluate(`document.querySelectorAll('.has-dropdown > a')[${index}].focus()`);
            assert.equal(await evaluate(`getComputedStyle(document.querySelectorAll('.dropdown-menu')[${index}]).display`), 'flex');
            assert.ok(await evaluate(`(() => { const r = document.querySelectorAll('.dropdown-menu')[${index}].getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`), `Dropdown overflow at ${width}px`);
        }
        await evaluate('document.activeElement.blur(); window.scrollTo(0, 0)');
        if (width === 1440 || width === 390) {
            const metrics = await send('Page.getLayoutMetrics');
            const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: metrics.cssContentSize.height, scale: 1 } });
            await writeFile(path.join(output, `homepage-${width}.png`), Buffer.from(shot.data, 'base64'));
        }
        console.log(`PASS ${width}px: layout, inline search, Escape, outside click, keyboard dropdowns`);
    }
    assert.deepEqual(missing, []);
    assert.deepEqual(exceptions, []);
    console.log('PASS local assets and browser runtime');
    await call('Browser.close');
} finally {
    if (socket) socket.close();
    browser.kill();
    server.close();
}
