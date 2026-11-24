// Regresi bug hasil audit (desktop & mobile). Jalankan: node test/regress.js
const { chromium } = require('playwright');
const path = require('path');
const APP = process.env.APP || path.resolve(__dirname, '../index.html'); // APP=... untuk menguji versi lama
const URL = 'file://' + APP;
const day = (n) => { const d = new Date(Date.now() - n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const cats = ['Makan Harian', 'Transport', 'To Invest', 'Hiburan', 'Kesehatan', 'Pendidikan', 'Cicilan', 'Hadiah', 'Liburan', 'Darurat'].map((n) => ({ name: n, note: '' }));
const base = { v: 1, cats, topups: cats.map((c, i) => ({ id: 't' + i, date: day(3), category: c.name, amount: 1000000, note: '' })), expenses: [{ id: 'e1', date: day(1), category: 'Darurat', amount: 12500.5, note: '=SUM(A1)' }, { id: 'e2', date: day(0), category: 'Transport', amount: 0.3, note: 'x' }], queue: [], cfg: { url: '', token: '' }, theme: 'auto', lastCat: '', lastSync: 0 };
const R = [];
const rec = (name, ok, info = '') => { R.push((ok ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };
(async () => {
  const b = await chromium.launch();
  const mk = async (vp, st = base, touch = true) => {
    const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
    await ctx.addInitScript((s) => { if (!localStorage.getItem('budgetsaver.v1')) localStorage.setItem('budgetsaver.v1', JSON.stringify(s)); }, st);
    const p = await ctx.newPage(); await p.goto(URL + '#/history'); await p.waitForTimeout(250); return { ctx, p };
  };
  // 1. chip scroll position kept after tapping a chip
  { const { ctx, p } = await mk({ width: 375, height: 700 });
    await p.evaluate(() => { document.querySelector('.chips').scrollLeft = 400; });
    const before = await p.evaluate(() => document.querySelector('.chips').scrollLeft);
    await p.evaluate(() => { const c = [...document.querySelectorAll('.chips .chip')].find((x) => /Liburan/.test(x.textContent)); c.click(); });
    await p.waitForTimeout(100);
    const after = await p.evaluate(() => document.querySelector('.chips').scrollLeft);
    rec('history chip scroll kept after tap', before > 0 && Math.abs(after - before) < 4, `before=${before} after=${after}`);
    await ctx.close(); }
  // 2. escape on "Unggah data lokal?" must not discard local data
  { const { ctx, p } = await mk({ width: 390, height: 800 });
    await p.route('https://script.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: JSON.stringify({ ok: true, results: [], data: { categories: [], topups: [], expenses: [] } }) }));
    await p.click('#pill'); await p.waitForTimeout(400);
    await p.fill('#cfg-url', 'https://script.google.com/macros/s/abc/exec'); await p.fill('#cfg-token', 'tok');
    await p.click('[data-act="connect"]'); await p.waitForTimeout(500);
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    const st = await p.evaluate(() => ({ n: window.__bs.S.expenses.length, url: window.__bs.S.cfg.url }));
    rec('dismissing upload dialog keeps local data', st.n === 2, JSON.stringify(st));
    await ctx.close(); }
  // 3. edit form with decimal amount from Sheets
  { const { ctx, p } = await mk({ width: 390, height: 800 });
    await p.click('[data-act="edit"][data-id="e1"]'); await p.waitForTimeout(400);
    const v = await p.inputValue('#f-amount');
    rec('edit shows decimal amount as integer rupiah', /^1[23]\.50[01]$/.test(v), 'value=' + v);
    await ctx.close(); }
  // 4. fmt tiny negative -> no "−Rp 0"
  { const { ctx, p } = await mk({ width: 390, height: 800 });
    const txt = await p.evaluate(() => document.body.innerText);
    rec('no "−Rp 0" artefact', !/−Rp 0(?!\d|\.)/.test(txt), (txt.match(/−Rp 0\S*/) || [''])[0]);
    await ctx.close(); }
  // 5. CSV injection
  { const { ctx, p } = await mk({ width: 1280, height: 800 }, base, false);
    await p.click('#pill'); await p.waitForTimeout(400);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="csv"]')]);
    const txt = require('fs').readFileSync(await dl.path(), 'utf8');
    rec('CSV neutralises leading "="', !/"=SUM/.test(txt), (txt.match(/"[=+@][^"]*"/) || [''])[0]);
    await ctx.close(); }
  // 6. focus stays inside open sheet (desktop Tab)
  { const { ctx, p } = await mk({ width: 1280, height: 800 }, base, false);
    await p.click('#add-btn'); await p.waitForTimeout(400);
    let out = false;
    for (let i = 0; i < 30; i++) { await p.keyboard.press('Tab'); if (await p.evaluate(() => !!document.activeElement.closest('.shell, #tabbar'))) { out = true; break; } }
    rec('Tab never reaches the page behind an open sheet', !out);
    await ctx.close(); }
  // 7. paste "25000.00" style decimals
  { const { ctx, p } = await mk({ width: 390, height: 800 });
    await p.click('#add-btn'); await p.waitForTimeout(400);
    await p.evaluate(() => { const a = document.querySelector('#f-amount'); a.focus(); const dt = new DataTransfer(); dt.setData('text', '25000.00'); a.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    const v = await p.inputValue('#f-amount');
    rec('pasted "25000.00" reads as 25.000', v === '25.000', 'value=' + v);
    await ctx.close(); }
  // 8. safe-area kiri/kanan benar-benar dipakai (Playwright tak bisa meniru notch; kita set variabelnya langsung)
  { const { ctx, p } = await mk({ width: 844, height: 390 });
    await p.evaluate(() => { document.documentElement.style.setProperty('--safe-l', '47px'); document.documentElement.style.setProperty('--safe-r', '47px'); });
    const pad = await p.evaluate(() => { const c = getComputedStyle(document.querySelector('.main')); return [c.paddingLeft, c.paddingRight]; });
    rec('content padding follows safe-area insets', pad[0] === '47px' && pad[1] === '47px', pad.join('/'));
    await ctx.close(); }
  // 9. angka besar & nama panjang tidak meluapkan halaman (HP kecil)
  for (const w of [320, 375, 430]) {
    const big = JSON.parse(JSON.stringify(base));
    big.cats[0].name = 'Makan & Minum Harian Keluarga Besar Sekali Nama Panjang';
    big.topups.forEach((t) => { t.category = big.cats.find((c) => c.name === t.category) ? t.category : t.category; });
    big.topups[0].category = big.cats[0].name; big.topups[0].amount = 999999999999;
    big.expenses.push({ id: 'big', date: day(0), category: big.cats[0].name, amount: 101097999, note: 'Besar' });
    const { ctx, p } = await mk({ width: w, height: 800 }, big);
    const over = async () => p.evaluate(() => { const vw = document.documentElement.clientWidth, o = [];
      if (document.documentElement.scrollWidth > vw + 1) o.push('doc-scroll'); 
      document.querySelectorAll('.hero, .hero .stat, .hero .stat b, .env, .summary, .summary .v, .mm-center, .mm-center b, .chipgrid .chip').forEach((el) => { const r = el.getBoundingClientRect(); if (r.width && (r.right > vw + 1 || r.left < -1)) o.push(el.className); });
      return o; });
    const o = [];
    for (const tab of ['home', 'history', 'map']) { await p.evaluate((x) => { location.hash = '#/' + x; }, tab); await p.reload(); await p.waitForTimeout(250); o.push(...(await over()).map((x) => tab + ':' + x)); }
    await p.click('#add-btn'); await p.waitForTimeout(400);
    o.push(...(await over()).map((x) => 'form:' + x));
    const o1 = o, o2 = [];
    rec(`no horizontal overflow at ${w}px (home, history, map, form)`, !o1.length && !o2.length, [...o1, ...o2].join(','));
    await ctx.close(); }
  // 10. kolom jumlah tidak memotong digit (bug iPhone: "80" tampil terpotong)
  { const { ctx, p } = await mk({ width: 390, height: 844 });
    await p.click('#add-btn'); await p.waitForTimeout(400);
    const bad = [];
    for (const v of ['8', '80', '8080', '125000', '999999999999']) {
      await p.fill('#f-amount', ''); await p.type('#f-amount', v);
      const m = await p.evaluate(() => { const a = document.querySelector('#f-amount'); return { v: a.value, sw: a.scrollWidth, cw: a.clientWidth, sl: a.scrollLeft }; });
      if (m.sw > m.cw || m.sl > 0) bad.push(`${m.v}: sw${m.sw}>cw${m.cw} sl${m.sl}`);
    }
    rec('amount input shows every digit', !bad.length, bad.join(' | '));
    await ctx.close(); }
  console.log(R.join('\n')); await b.close();
  if (R.some((x) => x.startsWith('FAIL'))) process.exit(1); console.log('REGRESS OK');
})();
