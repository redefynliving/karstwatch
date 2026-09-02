// Capture a 30-second demo video of a KarstWatch scan for marketing.
// Usage: node scripts/capture-demo.mjs
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { statSync, readdirSync, unlinkSync } from "node:fs";

const URL = "https://karstwatch.vercel.app/?scan=-86.5264,39.1653,-86.4864,39.2053";
const OUT = "public/demo-30s.mp4";
const VDIR = "/tmp/kw-demo";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  await mkdir(VDIR, { recursive: true });
  await mkdir("public", { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    recordVideo: { dir: VDIR },
  });
  const page = await ctx.newPage();

  console.log("→ navigating to", URL);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  console.log("→ waiting for scan results to surface (8s)…");
  await sleep(8000);

  // Capture the hero still at the golden moment
  try {
    await page.waitForSelector(":text(\"dips found\")", { timeout: 15000 });
    await page.screenshot({ path: "public/hero-sample.jpg", fullPage: false, type: "jpeg", quality: 78 });
    console.log("→ captured hero-sample.jpg");
  } catch {
    console.log("→ waiting a bit more…");
    await sleep(7000);
    await page.screenshot({ path: "public/hero-sample.jpg", fullPage: false, type: "jpeg", quality: 78 });
  }

  // Hold frame so there's a clean 30s of footage
  await sleep(12000);

  // Save the video before closing context (avoids the browser.close bug
  // when recordVideo is active)
  const video = page.video();
  console.log("→ saving video, closing context…");
  await ctx.close();
  await browser.close();

  const files = readdirSync(VDIR).filter((f) => f.endsWith(".webm"));
  if (files.length === 0) {
    console.error("✗ no webm recorded — ffmpeg video encoding may not be available");
    process.exit(1);
  }
  const src = `${VDIR}/${files[0]}`;
  console.log("→ recorded", src, statSync(src).size, "bytes");

  // Trim to first 30s, encode H.264
  execFileSync("ffmpeg", [
    "-i", src,
    "-t", "30",
    "-vf", "fps=24,scale=1280:800",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-an",
    OUT,
  ], { stdio: "pipe" });

  console.log("✓ saved", OUT, statSync(OUT).size, "bytes");
  unlinkSync(src);
};

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
