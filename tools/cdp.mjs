// Minimal Chrome DevTools Protocol driver for smoke tests (Node 22+, no dependencies).
//   const b = await launch(); const p = await b.page('http://localhost:8080/play.html');
//   await p.waitFor('!!window.__mabar'); await p.shot('x.png'); console.log(p.problems()); b.close();
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEYS = { Space: [' ', 32], Enter: ['Enter', 13], Escape: ['Escape', 27], KeyW: ['w', 87], KeyA: ['a', 65], KeyS: ['s', 83], KeyD: ['d', 68], KeyE: ['e', 69], KeyF: ['f', 70], KeyX: ['x', 88], KeyH: ['h', 72], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], Digit1: ['1', 49], Digit2: ['2', 50], Digit3: ['3', 51], Digit4: ['4', 52] };

export async function launch({ port = 9333, width = 1280, height = 720, args = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mabar-chrome-'));
  const proc = spawn(CHROME, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--headless=new', `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio', ...args,
  ], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 100 && !ver; i++) {
    try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(150); }
  }
  if (!ver) { proc.kill(); throw new Error('Chrome did not start'); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(m.error.message)); else res(m.result);
    } else for (const fn of listeners) fn(m);
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  // block: URL patterns that fail to load (e.g. ['*bunny.glb']) to test fallbacks.
  async function page(url, { w = width, h = height, block = [] } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    const log = [];
    const reqs = new Map();
    listeners.add((m) => {
      if (m.sessionId !== sessionId) return;
      const p = m.params || {};
      switch (m.method) {
        case 'Runtime.consoleAPICalled':
          log.push({ type: p.type, text: (p.args || []).map((a) => (a.value !== undefined ? a.value : a.description)).join(' ') });
          break;
        case 'Runtime.exceptionThrown':
          log.push({ type: 'exception', text: (p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text });
          break;
        case 'Network.requestWillBeSent': reqs.set(p.requestId, p.request.url); break;
        case 'Network.responseReceived':
          if (p.response.status >= 400) log.push({ type: 'http', text: `${p.response.status} ${p.response.url}` });
          break;
        case 'Network.loadingFailed':
          if (!p.canceled) log.push({ type: 'netfail', text: `${p.errorText} ${reqs.get(p.requestId) || ''}` });
          break;
        case 'Log.entryAdded':
          log.push({ type: `log-${p.entry.level}`, text: `${p.entry.text} ${p.entry.url || ''}` });
          break;
      }
    });
    await s('Runtime.enable');
    await s('Network.enable');
    await s('Log.enable');
    await s('Page.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    if (block.length) await s('Network.setBlockedURLs', { urls: block });
    await s('Page.navigate', { url });
    const api = {
      log,
      async eval(expr) {
        const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
        return r.result.value;
      },
      async waitFor(expr, timeout = 20000) {
        const t0 = Date.now();
        for (;;) {
          let ok = false;
          try { ok = await api.eval(`!!(${expr})`); } catch { ok = false; }
          if (ok) return true;
          if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${expr}`);
          await sleep(100);
        }
      },
      async shot(file) {
        const r = await s('Page.captureScreenshot', { format: 'png' });
        writeFileSync(file, Buffer.from(r.data, 'base64'));
      },
      async key(code, holdMs = 60) {
        const [key, vk] = KEYS[code];
        await s('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: vk });
        await sleep(holdMs);
        await s('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk });
      },
      // Console errors, uncaught exceptions and failed requests, minus expected ones.
      problems(allow = []) {
        return log.filter((e) => ['error', 'exception', 'http', 'netfail', 'log-error'].includes(e.type))
          .filter((e) => !allow.some((a) => (a instanceof RegExp ? a.test(e.text) : e.text.includes(a))));
      },
      sleep,
      close: () => send('Target.closeTarget', { targetId }),
    };
    return api;
  }

  return { page, send, close() { try { ws.close(); } catch {} proc.kill('SIGKILL'); } };
}
