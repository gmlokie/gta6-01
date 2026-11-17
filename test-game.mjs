// Local QA driver for SOLMAR BAY (gta6-01): self-test + 4 screenshots.
// Uses playwright-core with the cached Chromium build (no downloads).
// Usage: node test-game.mjs [screenshots-out-dir] [all|selftest|shots]
// playwright-core lives in the fps-01 work dir; import by absolute path so
// this driver needs no node_modules symlink inside the entry.
import { chromium } from '/home/hatch/workspace/bounty-tools/makefun/entries/threejs-fps-01/work/node_modules/playwright-core/index.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = 'http://localhost:8080';
const OUT = process.argv[2] || '/home/hatch/workspace/bounty-tools/makefun/entries/gta6-01-r2/screenshots';
const exe = execSync('ls -d /home/hatch/.cache/ms-playwright/chromium-*/chrome-linux/chrome 2>/dev/null | head -1', { encoding: 'utf8' }).trim()
  || execSync('ls -d /home/hatch/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell 2>/dev/null | head -1', { encoding: 'utf8' }).trim();
console.log('chromium:', exe);
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 400)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 500)));

const mode = process.argv[3] || 'all';

if (mode === 'all' || mode === 'selftest') {
  await page.goto(BASE + '/?selftest=1&seed=7', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__selftest, null, { timeout: 30000 });
  const st = await page.evaluate(() => window.__selftest);
  console.log(`SELFTEST ${st.pass}/${st.total}`);
  for (const r of st.results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'} ${r.name} — ${r.detail}`);
  fs.writeFileSync('/home/hatch/workspace/bounty-tools/makefun/entries/gta6-01-r2/selftest.json', JSON.stringify(st, null, 2));
}

if (mode === 'all' || mode === 'shots') {
  fs.mkdirSync(OUT, { recursive: true });
  // Dossier cap: max 4 screenshots, each <=256 KiB. The 4 gameplay stills go
  // to OUT as JPEG; the menu still is archive-only (shots-png/), never in the entry.
  const ARCHIVE = '/home/hatch/workspace/bounty-tools/makefun/entries/gta6-01-r2/shots-png';
  fs.mkdirSync(ARCHIVE, { recursive: true });
  for (const [shot, out] of [['menu', null], ['city', '1-city.jpg'], ['drive', '2-drive.jpg'], ['chase', '3-chase.jpg']]) {
    await page.goto(`${BASE}/?shot=${shot}&seed=7`, { waitUntil: 'load' });
    try {
      await page.waitForFunction(() => window.__shotReady, null, { timeout: 30000 });
    } catch { console.log(`shot ${shot}: __shotReady TIMEOUT`); }
    await page.waitForTimeout(1500);
    const file = shot === 'menu' ? `${ARCHIVE}/menu.jpg` : `${OUT}/${out}`;
    await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
    const sz = fs.statSync(file).size;
    console.log(`shot ${shot}: ${file} ${sz} bytes`);
  }
  // mission shot is the 4th deliverable: plaza standoff
  await page.goto(`${BASE}/?shot=mission&seed=7`, { waitUntil: 'load' });
  try { await page.waitForFunction(() => window.__shotReady, null, { timeout: 30000 }); } catch { console.log('shot mission: __shotReady TIMEOUT'); }
  await page.waitForTimeout(1500);
  const file = `${OUT}/4-mission.jpg`;
  await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
  console.log(`shot mission: ${file} ${fs.statSync(file).size} bytes`);
}
await browser.close();
console.log('done');
