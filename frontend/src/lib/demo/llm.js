// LLM provider interface. Today: a deterministic mock that produces a
// reasonable NL/EN outreach email and narrative. Tomorrow: the same interface
// backed by Vertex AI Gemini (service account) or the Gemini API (API key),
// whichever the user configured.
//
// NO CODE CHANGES required elsewhere to switch providers — just drop an
// API key in .env and call llmProvider() to see which one is active.

const SYSTEM_BEHAVIOR = `You are ParkScan, an AI concierge for SULC Advisors that identifies
vacant Dutch buildings suitable for parking conversion and drafts brief, polite landlord outreach
in Dutch (nl-NL). Be formal, specific, and reference concrete figures from the provided site
data. Keep emails under 180 words.`;

export function llmProvider() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return "vertex_gemini";
  if (process.env.GEMINI_API_KEY) return "gemini_api";
  return "mock";
}

export function llmEnabled() {
  return llmProvider() !== "mock";
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate an outreach email to the property owner.
 * @param {object} ctx — { site, score, owner, conversion }
 * @returns {Promise<{ subject, body, provider }>}
 */
export async function generateOutreachEmail(ctx) {
  const provider = llmProvider();
  if (provider === "mock") return mockOutreach(ctx);
  try {
    if (provider === "vertex_gemini") return await vertexOutreach(ctx);
    if (provider === "gemini_api") return await geminiApiOutreach(ctx);
  } catch (err) {
    console.warn(`[llm] ${provider} failed; falling back to mock:`, err.message);
    return mockOutreach(ctx);
  }
  return mockOutreach(ctx);
}

/**
 * Write a short narrative summary of the vacancy case.
 * @returns {Promise<{ text, provider }>}
 */
export async function generateNarrative(ctx) {
  const provider = llmProvider();
  if (provider === "mock") return mockNarrative(ctx);
  try {
    if (provider === "vertex_gemini") return await vertexNarrative(ctx);
    if (provider === "gemini_api") return await geminiApiNarrative(ctx);
  } catch (err) {
    console.warn(`[llm] ${provider} failed; falling back to mock:`, err.message);
    return mockNarrative(ctx);
  }
  return mockNarrative(ctx);
}

// ── Mock implementations ───────────────────────────────────────────────────
function fmtEur(n) {
  return `€${Number(n).toLocaleString("nl-NL")}`;
}

function mockOutreach({ site, score, owner, conversion }) {
  const signals = (score?.reasons || [])
    .filter((r) => r.type !== "parking")
    .slice(0, 2)
    .map((r) => `- ${r.label}`);
  const revenue = conversion
    ? `${fmtEur(conversion.revenueLow)} – ${fmtEur(conversion.revenueHigh)}/maand`
    : "een aantrekkelijke maandelijkse inkomstenstroom";
  const spaces = conversion?.spacesEst ? `${conversion.spacesEst} parkeerplaatsen` : "parkeerplaatsen";

  const subject = `Voorstel: herbestemming ${site.address} naar parkeervoorziening`;
  const body = [
    `Geachte ${owner?.ownerName || "eigenaar"},`,
    ``,
    `SULC Advisors heeft uw object aan ${site.address} geïdentificeerd als een kansrijke locatie`,
    `voor tijdelijke ombouw tot een moderne parkeervoorziening. Op basis van BAG-data en openbare`,
    `signalen tonen wij aanwijzingen voor langdurige leegstand:`,
    ``,
    signals.length ? signals.join("\n") : `- Indicaties van verminderd gebruik`,
    ``,
    `Het pand biedt op ${site.areaSqm}m² ruimte voor naar schatting ${spaces}, met een`,
    `verwachte brutomaandopbrengst van ${revenue}. Activatie is mogelijk binnen`,
    `${conversion?.activationDaysLow ?? 21}–${conversion?.activationDaysHigh ?? 60} dagen.`,
    ``,
    `Wij horen graag of u openstaat voor een kort vrijblijvend gesprek.`,
    ``,
    `Met vriendelijke groet,`,
    `SULC Advisors — ParkScan`,
  ].join("\n");

  return { subject, body, provider: "mock" };
}

function mockNarrative({ site, score, conversion }) {
  const topReason = score?.reasons?.[0]?.label || "meerdere vacancy-signalen";
  const spaces = conversion?.spacesEst ? `~${conversion.spacesEst} parkeerplaatsen` : "parkeerplaatsen";
  const rev = conversion?.revenueBase ? ` en circa ${fmtEur(conversion.revenueBase)}/maand` : "";
  return {
    text: `Locatie ${site.address} scoort ${score?.vacancyScore ?? "–"}/100 op vacancy (${topReason}) ` +
          `en ${score?.parkingScore ?? "–"}/100 op parkeergeschiktheid. ` +
          `Op ${site.areaSqm}m² zijn ${spaces} te realiseren${rev}.`,
    provider: "mock",
  };
}

// ── Vertex AI (Gemini) via service account ─────────────────────────────────
// Implemented as a thin Google AI SDK wrapper the moment creds exist.
// We keep it lazy-loaded so the @google-cloud/vertexai dep stays optional.
let _vertexClient = null;
async function vertexClient() {
  if (_vertexClient) return _vertexClient;
  const { VertexAI } = await import("@google-cloud/vertexai").catch(() => ({}));
  if (!VertexAI) {
    throw new Error("@google-cloud/vertexai not installed — run `npm i @google-cloud/vertexai`");
  }
  const project = process.env.GOOGLE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  const location = process.env.GOOGLE_LOCATION || "us-central1";
  if (!project) throw new Error("GOOGLE_PROJECT_ID not set");
  _vertexClient = new VertexAI({ project, location });
  return _vertexClient;
}

async function vertexGenerate(prompt) {
  const client = await vertexClient();
  const model = client.getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    systemInstruction: { parts: [{ text: SYSTEM_BEHAVIOR }] },
  });
  const result = await model.generateContent(prompt);
  return result?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function vertexOutreach(ctx) {
  const text = await vertexGenerate(outreachPrompt(ctx));
  const { subject, body } = parseSubjectBody(text);
  return { subject, body, provider: "vertex_gemini" };
}

async function vertexNarrative(ctx) {
  const text = await vertexGenerate(narrativePrompt(ctx));
  return { text: text.trim(), provider: "vertex_gemini" };
}

// ── Gemini API (API-key auth, cheaper path) ────────────────────────────────
async function geminiApiCall(prompt) {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { role: "system", parts: [{ text: SYSTEM_BEHAVIOR }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function geminiApiOutreach(ctx) {
  const text = await geminiApiCall(outreachPrompt(ctx));
  const { subject, body } = parseSubjectBody(text);
  return { subject, body, provider: "gemini_api" };
}

async function geminiApiNarrative(ctx) {
  const text = await geminiApiCall(narrativePrompt(ctx));
  return { text: text.trim(), provider: "gemini_api" };
}

// ── Prompts ────────────────────────────────────────────────────────────────
function outreachPrompt({ site, score, owner, conversion }) {
  const reasons = (score?.reasons || []).map((r) => `- ${r.label} (${r.weight > 0 ? "+" : ""}${r.weight})`).join("\n");
  return [
    `Schrijf een formele outreach e-mail in het Nederlands aan ${owner?.ownerName || "de eigenaar"} over het pand ${site.address}.`,
    `Gebruik de volgende gegevens:`,
    ``,
    `Pand: ${site.address}`,
    `Gebruiksdoel: ${site.usePurpose}  |  Oppervlakte: ${site.areaSqm}m²  |  Bouwjaar: ${site.buildYear}`,
    `Vacancy score: ${score?.vacancyScore}/100   Parkeergeschiktheid: ${score?.parkingScore}/100`,
    `Conversiemodel: ${conversion?.spacesEst || "?"} parkeerplaatsen, ` +
      `${fmtEur(conversion?.revenueLow || 0)}–${fmtEur(conversion?.revenueHigh || 0)}/maand, ` +
      `payback ${conversion?.roiMonths ?? "?"} mnd.`,
    ``,
    `Signalen:`,
    reasons,
    ``,
    `Lever de output in dit exacte format:`,
    `Subject: <onderwerp in één zin>`,
    `Body: <e-mailtekst>`,
  ].join("\n");
}

function narrativePrompt({ site, score, conversion }) {
  return `Schrijf 2-3 zinnen Nederlandse samenvatting voor een intern dossier over ` +
    `het pand ${site.address}. Noem de vacancy score (${score?.vacancyScore}/100), ` +
    `parkeergeschiktheid (${score?.parkingScore}/100), oppervlakte ${site.areaSqm}m², ` +
    `en geschatte opbrengst ${fmtEur(conversion?.revenueBase || 0)}/maand.`;
}

function parseSubjectBody(text) {
  const subjectMatch = /Subject:\s*(.+)/i.exec(text);
  const bodyMatch = /Body:\s*([\s\S]+)/i.exec(text);
  const subject = subjectMatch ? subjectMatch[1].trim() : "Voorstel parkeervoorziening";
  const body = bodyMatch ? bodyMatch[1].trim() : text.trim();
  return { subject, body };
}
