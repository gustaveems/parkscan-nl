// Puppeteer is server-only; the demo build reports as printable HTML instead.

export async function renderReportPdf() {
  const err = new Error("PDF rendering is disabled in the browser demo — use Print → Save as PDF");
  err.code = "DEMO_NO_PDF";
  throw err;
}

export function shutdownPdfBrowser() {}
