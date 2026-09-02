// Capture a clean hero screenshot of a KarstWatch scan result.
// Uses the fresh screenshot to verify the OpenFreeMap basemap renders clean.
// Usage: node scripts/capture-hero.mjs
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = "https://karstwatch.vercel.app/?scan=-86.5264,39.1653,-86.4864,39.2053";
const OUT = "public/hero-sample.jpg";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  await mkdir("public", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  console.log("→ navigating to", URL);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  console.log("→ waiting for results panel…");
  try {
    await page.waitForSelector("section:has-text(\"dips found\")", { timeout: 15000 });
  } catch {
    console.log("→ (results not ready; capturing anyway)");
  }
  await sleep(3000); // let tiles + markers settle

  console.log("→ capturing");
  await page.screenshot({ path: OUT, fullPage: false, type: "jpeg", quality: 78 });
  await browser.close();
  console.log("✓ saved", OUT);
};

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
