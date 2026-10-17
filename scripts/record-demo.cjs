// Records docs/demo.gif: a scripted walkthrough of the plugin in the dev harness.
//
//   yarn harness                      # in another terminal
//   NODE_PATH="$(npm root -g)" node scripts/record-demo.cjs
//
// Needs ffmpeg on the PATH and Playwright installed globally with its Chromium:
// `npm install -g playwright && npx playwright install chromium`.
// Frames come from Chromium's screencast, which is sharper than Playwright's video recorder.
// Pass --mp4 to also write docs/demo.mp4 (not committed).
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "pivot-demo-"));
const HARNESS = process.env.HARNESS_URL || "http://localhost:5199";

const W = 1180;
const H = 760;

// Injected into the plugin iframe: an arrow cursor, click ripples and a label that follows drags.
const CURSOR_JS = `(() => {
  if (window.__demoCursor) return;
  const style = document.createElement('style');
  style.textContent = \`
    #demo-cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; z-index: 2147483647; pointer-events: none;
      transform: translate(-100px, -100px); filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
    .demo-ripple { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
      background: rgba(250, 216, 59, .55); pointer-events: none; z-index: 2147483646; animation: demo-ripple .45s ease-out forwards; }
    @keyframes demo-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
    #demo-ghost { position: fixed; left: 0; top: 0; z-index: 2147483645; pointer-events: none; padding: 3px 9px; border-radius: 4px;
      font: 600 12px system-ui, sans-serif; background: #fad83b; color: #111; box-shadow: 0 4px 14px rgba(0,0,0,.25); opacity: .95; }
  \`;
  document.head.appendChild(style);
  const c = document.createElement('div');
  c.id = 'demo-cursor';
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.4 L10.1 13 L16 13 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(c);
  let ghost = null;
  const move = (x, y) => {
    c.style.transform = 'translate(' + (x - 3) + 'px,' + (y - 2) + 'px)';
    if (ghost) ghost.style.transform = 'translate(' + (x + 14) + 'px,' + (y + 12) + 'px)';
  };
  window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY), true);
  window.addEventListener('dragover', (e) => move(e.clientX, e.clientY), true);
  window.addEventListener('mousedown', (e) => {
    const r = document.createElement('div');
    r.className = 'demo-ripple';
    r.style.left = e.clientX + 'px';
    r.style.top = e.clientY + 'px';
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 500);
  }, true);
  window.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.chip, .field');
    const label = el ? (el.querySelector('.chip-label, .field-name') || el).textContent.trim() : '';
    ghost = document.createElement('div');
    ghost.id = 'demo-ghost';
    ghost.textContent = label;
    document.body.appendChild(ghost);
    move(e.clientX, e.clientY);
  }, true);
  const end = () => { if (ghost) { ghost.remove(); ghost = null; } };
  window.addEventListener('drop', end, true);
  window.addEventListener('dragend', end, true);
  window.__demoCursor = true;
})();`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => console.log("pageerror", e.message));

  // Start from a plain count by category rather than the suggested layout, so the demo can build it up.
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const config = { rows: ["category"], cols: [], filters: [], fieldOptions: {}, values: [{ id: "count", field: null, agg: "count", showAs: "value" }] };
    localStorage.setItem("pivot-dev-host-state", JSON.stringify({ version: 1, source: null, config, maxRows: 10000, heatmap: false }));
  });
  await page.goto(`${HARNESS}/dev/host.html?command=pivot-query&theme=light`);
  await page.addStyleTag({ content: "#bar { display: none !important; } #toasts { bottom: 18px; right: 18px; } .toast { font-size: 14px; padding: 10px 16px; }" });
  const frameHandle = await (await page.waitForSelector("#plugin")).contentFrame();
  const f = page.frameLocator("#plugin");
  // A restored query tab waits for a click before running.
  await f.locator("button", { hasText: "Run query" }).click();
  await f.locator(".pivot-table").waitFor();
  await frameHandle.evaluate(CURSOR_JS);

  // ---- recording ----
  const cdp = await page.context().newCDPSession(page);
  let n = 0;
  const frames = [];
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = path.join(OUT, `f${String(n++).padStart(5, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp });
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });


  let pos = { x: 700, y: 420 };
  const wait = (ms) => page.waitForTimeout(ms);
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  async function glide(x, y, ms = 600) {
    const steps = Math.max(8, Math.round(ms / 16));
    const from = { ...pos };
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
      await wait(ms / steps);
    }
    pos = { x, y };
  }
  async function center(locator) {
    await locator.scrollIntoViewIfNeeded();
    const b = await locator.boundingBox();
    return { x: b.x + Math.min(b.width / 2, 60), y: b.y + b.height / 2 };
  }
  async function click(locator, ms = 420) {
    const p = await center(locator);
    await glide(p.x, p.y, ms);
    await wait(120);
    await page.mouse.down();
    await wait(70);
    await page.mouse.up();
  }
  async function drag(from, to, ms = 650) {
    const a = await center(from);
    await glide(a.x, a.y, 420);
    await wait(110);
    await page.mouse.down();
    const b = await to.boundingBox();
    const target = { x: b.x + b.width - 40, y: b.y + b.height / 2 + 6 };
    await glide(a.x + 12, a.y + 6, 120);
    await glide(target.x, target.y, ms);
    await wait(100);
    await page.mouse.up();
  }
  const field = (name) => f.locator(".field", { has: f.locator(".field-name", { hasText: new RegExp(`^${name}$`) }) });
  const zone = (z) => f.locator(`.zone[data-zone="${z}"]`);
  const dialog = f.locator('[role="dialog"]');

  await page.mouse.move(pos.x, pos.y);
  await wait(792);

  // 1. Region across the top
  await drag(field("region"), zone("cols"));
  await wait(648);

  // 2. Sum of amount, then drop the row count
  await drag(field("amount"), zone("values"));
  await wait(576);
  await click(zone("values").locator(".chip", { hasText: "Count" }));
  await wait(360);
  await click(dialog.locator(".menu-item", { hasText: "Remove" }));
  await wait(648);

  // 3. Dates into rows, then group by year
  await drag(field("order_date"), zone("rows"));
  await wait(936);
  await click(zone("rows").locator(".chip", { hasText: "order_date" }));
  await wait(360);
  const select = dialog.locator("select").first();
  await glide((await center(select)).x, (await center(select)).y, 450);
  await wait(250);
  await select.selectOption("year");
  await wait(504);
  await glide(pos.x + 340, pos.y + 60, 500);
  await page.mouse.down();
  await page.mouse.up();
  await wait(648);

  // 4. Subtotals and a heatmap
  await click(f.locator(".options summary"));
  await wait(288);
  await click(f.locator(".opt", { hasText: "Subtotals" }).locator("input"));
  await wait(504);
  await click(f.locator(".opt", { hasText: "Heatmap" }).locator("input"));
  await wait(792);

  // 5. Filter out a channel
  await drag(field("channel"), zone("filters"));
  await wait(432);
  await click(zone("filters").locator(".chip"));
  await wait(360);
  await click(dialog.locator(".vf-list li", { hasText: "Partner" }).locator("input"));
  await wait(504);
  await page.keyboard.press("Escape");
  await wait(648);

  // 6. Show as % of column total
  await click(zone("values").locator(".chip"));
  await wait(360);
  const showAs = dialog.locator("select").nth(2);
  await glide((await center(showAs)).x, (await center(showAs)).y, 450);
  await wait(250);
  await showAs.selectOption("pctColTotal");
  await wait(936);
  await showAs.selectOption("value");
  await wait(360);
  await page.keyboard.press("Escape");
  await wait(432);

  // 7. Title it
  await click(f.locator(".title-input"));
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Revenue by region and year", { delay: 45 });
  await page.keyboard.press("Enter");
  await wait(504);

  // 8. Export menu, then copy as image
  await click(f.locator(".toolbar button", { hasText: "Export" }));
  await wait(288);
  const items = dialog.locator(".menu-item");
  for (let i = 0; i < 8; i++) {
    const p = await center(items.nth(i));
    await glide(p.x, p.y, 110);
    await wait(55);
  }
  await wait(432);
  await page.keyboard.press("Escape");
  await wait(288);
  await click(f.locator(".toolbar button", { hasText: "Copy" }));
  await wait(360);
  await click(dialog.locator(".menu-item", { hasText: "Copy as image" }));
  await wait(1728);

  await cdp.send("Page.stopScreencast");
  await wait(200);
  await browser.close();
  console.log("frames:", frames.length, "duration:", (frames.at(-1).t - frames[0].t).toFixed(1), "s");

  // Each frame is shown until the next one arrived, so pauses keep their real length.
  const list = frames.map((fr, i) => {
    const d = i + 1 < frames.length ? frames[i + 1].t - fr.t : 2;
    return `file '${fr.file}'\nduration ${Math.max(d, 0.001).toFixed(4)}`;
  });
  list.push(`file '${frames.at(-1).file}'`);
  fs.writeFileSync(path.join(OUT, "list.txt"), list.join("\n") + "\n");
  const mp4 = path.join(process.argv.includes("--mp4") ? path.join(ROOT, "docs") : OUT, "demo.mp4");
  const ffmpeg = (args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  ffmpeg(["-f", "concat", "-safe", "0", "-i", path.join(OUT, "list.txt"), "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "18", "-movflags", "+faststart", mp4]);
  ffmpeg([
    "-i", mp4,
    "-vf", "setpts=PTS/1.2,fps=15,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
    "-loop", "0", path.join(ROOT, "docs", "demo.gif"),
  ]);
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log("Wrote docs/demo.gif");
})();
