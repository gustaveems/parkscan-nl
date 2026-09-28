import "dotenv/config";
import express from "express";
import cors from "cors";
import { pathToFileURL } from "url";
import apiRouter from "./routes/api.js";
import { shutdownPdfBrowser } from "./services/pdf.js";
import { initStore, shutdownPool, getStore } from "./db/index.js";
import { llmProvider } from "./services/llm.js";
import { visionProvider } from "./services/vision.js";
import { bagBevragingenEnabled } from "./services/bag.js";
import { startOutreachWorker, stopOutreachWorker } from "./services/outreachAutomation.js";

const PORT = process.env.PORT || 3001;

export function providerStatus() {
  return {
    store: getStore().name,
    places: Boolean(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY)
      ? "google_places"
      : "mock",
    streetview: Boolean(
      process.env.GOOGLE_STREET_VIEW_STATIC_API_KEY || process.env.GOOGLE_MAPS_API_KEY
    )
      ? "google_streetview"
      : "mock",
    maps: Boolean(
      process.env.GOOGLE_MAPS_STATIC_API_KEY || process.env.GOOGLE_MAPS_API_KEY
    )
      ? "google_maps_static"
      : "mock",
    bag: bagBevragingenEnabled() ? "bag_bevragingen" : "pdok_locatieserver",
    llm: llmProvider(),
    vision: visionProvider(),
  };
}

export function createApp() {
  const app = express();

  app.use(cors({ origin: ["http://localhost:5173", "http://localhost:4173"] }));
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", apiRouter);

  app.get("/health", (req, res) =>
    res.json({
      status: "ok",
      providers: providerStatus(),
      timestamp: new Date().toISOString(),
    }),
  );

  app.get("/api/providers", (req, res) => res.json(providerStatus()));
  return app;
}

export async function startServer() {
  await initStore();
  startOutreachWorker();
  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`ParkScan NL backend running on http://localhost:${PORT}`);
  });

  async function gracefulShutdown() {
    server.close(() => {});
    stopOutreachWorker();
    await Promise.allSettled([shutdownPdfBrowser(), shutdownPool()]);
    process.exit(0);
  }
  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((err) => {
    console.error("Fatal startup error:", err);
    process.exit(1);
  });
}
