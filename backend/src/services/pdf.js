import puppeteer from "puppeteer";

// Tiny HTML escaper for values we interpolate into Puppeteer header/footer
// templates. Templates are rendered inside an isolated frame as raw HTML, so
// any address with `<` or `&` would otherwise break the layout.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Keep a single Chromium instance alive across requests.
// In production you'd want a worker pool and lifecycle monitoring, but for
// dev + MVP a singleton is fine: cold start is ~1s, warm start is ~150ms.
let browserPromise = null;
let closing = false;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
      })
      .then((browser) => {
        browser.on("disconnected", () => {
          if (!closing) browserPromise = null;
        });
        return browser;
      });
  }
  return browserPromise;
}

export async function shutdownPdfBrowser() {
  if (!browserPromise) return;
  closing = true;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    // best effort
  } finally {
    browserPromise = null;
    closing = false;
  }
}

export async function renderReportPdf(
  siteId,
  { frontendUrl = "http://localhost:5173" } = {}
) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1100, height: 1600, deviceScaleFactor: 2 });
    // The PDF should look like the on-screen "print mode" we built into the
    // ReportPage — emulating `screen` keeps our `.print-mode` class styles in
    // effect (we control print styles inline; we don't rely on @media print).
    await page.emulateMediaType("screen");

    const url = `${frontendUrl}/sites/${encodeURIComponent(siteId)}/report?print=1`;
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });

    // Wait for the new report container before snapshotting.
    await page.waitForSelector(".report-doc .rd-card", { timeout: 15000 });

    // Wait for all images (map + 4 cardinal Street View tiles) to finish so
    // we never PDF a half-loaded visual survey.
    await page.evaluate(async () => {
      const imgs = Array.from(document.images);
      await Promise.all(
        imgs.map((img) =>
          img.complete && img.naturalWidth > 0
            ? Promise.resolve()
            : new Promise((res) => {
                img.addEventListener("load", res, { once: true });
                img.addEventListener("error", res, { once: true });
              })
        )
      );
    });
    await new Promise((r) => setTimeout(r, 200));

    // Pull the site address out of the rendered page so we can show it in the
    // PDF's running header (Puppeteer header templates don't have access to
    // the document's DOM).
    const siteAddress = await page
      .evaluate(() => document.querySelector(".rd-title-h1")?.textContent?.trim() || "")
      .catch(() => "");
    const headerAddress = escapeHtml(siteAddress).slice(0, 90);

    // Header / footer templates render in their own isolated frame, so all
    // styles must be inline and font-size must be explicit (Chromium defaults
    // are tiny). printBackground does NOT extend to these templates.
    const headerTemplate = `
      <div style="
        width: 100%;
        padding: 0 14mm;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif;
        font-size: 8.5px;
        color: #475569;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid #e2e8f0;
        padding-bottom: 4px;
      ">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="
            display: inline-block;
            width: 14px; height: 14px;
            background: #2563eb;
            color: #ffffff;
            border-radius: 3px;
            font-weight: 700;
            font-size: 9px;
            line-height: 14px;
            text-align: center;
          ">P</span>
          <span style="font-weight: 700; color: #0f172a;">ParkScan NL</span>
          <span style="color: #94a3b8;">·</span>
          <span>Site Dossier</span>
        </div>
        <div style="color: #64748b; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${headerAddress}
        </div>
      </div>
    `;

    const footerTemplate = `
      <div style="
        width: 100%;
        padding: 4px 14mm 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif;
        font-size: 8px;
        color: #64748b;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-top: 1px solid #e2e8f0;
      ">
        <div>
          <span style="color: #94a3b8;">Confidential</span>
          <span style="color: #cbd5e1; margin: 0 4px;">·</span>
          <span>SULC Advisors — ParkScan NL</span>
        </div>
        <div>
          Page <span class="pageNumber"></span> of <span class="totalPages"></span>
        </div>
      </div>
    `;

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      // Don't trust the document's @page size — we want our margins to win so
      // the header/footer have room.
      preferCSSPageSize: false,
      displayHeaderAndFooter: true,
      headerTemplate,
      footerTemplate,
      margin: { top: "22mm", right: "12mm", bottom: "18mm", left: "12mm" },
    });
    return pdf;
  } finally {
    await page.close().catch(() => {});
  }
}
