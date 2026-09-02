// Capture a hero screenshot of the KarstWatch results panel for a known
// karst town. Saves to public/hero-sample.png and prints size.
// Usage: node scripts/capture-hero.mjs
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = "https://karstwatch.vercel.app/?scan=-86.5264,39.1653,-86.4864,39.2053";
// Bloomington downtown — known karst area; should fire the full pipeline
const OUT = "public/hero-sample.jpg";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  await mkdir("public", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1, // keep file size small for the hero <img>
  });
  const page = await ctx.newPage();
  console.log("→ navigating to", URL);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait for results sidebar (or any sign a scan is running)
  console.log("→ waiting for map or scan completion signal…");
  try {
    await page.waitForSelector(
      '[data-kw="results"], section:has-text("dip"), .kw-animate-pop, [class*="animate-pop"]',
      { timeout: 25000 },
    );
  } catch (e) {
    console.log("  no result panel yet — capturing what we have");
  }

  // Give the map tiles + scoring a beat to settle
  await sleep(4000);

  console.log("→ capturing");
  // JPEG quality 78 = ~80KB target for a 1280×800 image
  await page.screenshot({ path: OUT, fullPage: false, type: "jpeg", quality: 78 });
  await browser.close();
  console.log("✓ saved", OUT);
};

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
