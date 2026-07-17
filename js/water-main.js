import { probeWebGL, yieldToMain } from "./platform/WebGLProbe.js";
import { LoadingManager } from "./platform/LoadingManager.js";
import { LoadingUI, publishLoadReport } from "./ui/LoadingUI.js";
import { createWaterSimulation, WATER_LOAD_STAGES } from "./WaterLabSimulation.js";

const LOAD_TIMEOUT_MS = 120000;

function installGlobalErrorHandlers(loadingUI, loader) {
  window.addEventListener("error", (e) => {
    if (e.message?.includes("Import") || e.filename?.includes(".js")) {
      loadingUI.showError(
        "Failed to load simulation scripts.",
        e.message || "Check your network connection and try again.",
        loader?.getReport()
      );
    }
  });
  window.addEventListener("unhandledrejection", (e) => {
    loadingUI.showError(
      "The simulation failed to start.",
      e.reason?.message ?? String(e.reason ?? "Unknown error"),
      loader?.getReport()
    );
  });
}

async function runLoadPipeline(loadingUI) {
  const loader = new LoadingManager(WATER_LOAD_STAGES);
  loadingUI.bind(loader);
  installGlobalErrorHandlers(loadingUI, loader);

  loader.markBootStart();

  const timeout = setTimeout(() => {
    loadingUI.showError(
      "Loading is taking longer than expected.",
      "Try refreshing. First load on mobile can take up to a minute.",
      loader.getReport()
    );
  }, LOAD_TIMEOUT_MS);

  try {
    await loader.runStage("webgl_probe", async () => {
      await yieldToMain();
      const glInfo = probeWebGL();
      if (!glInfo.supported) {
        throw new Error("WebGL is not available. Update your browser or enable hardware acceleration.");
      }
      return glInfo;
    });

    const canvas = document.getElementById("canvas");
    if (!canvas) throw new Error("Canvas element not found.");

    await loader.runStage("engine_module", async () => {
      await yieldToMain();
      return true;
    });

    const sim = await createWaterSimulation(canvas, loader);
    const report = loader.getReport();
    publishLoadReport(report);
    sim.start(loadingUI);
  } catch (err) {
    console.error(err);
    loadingUI.showError(
      "The simulation failed to start.",
      err?.message ?? "Unknown error",
      loader.getReport()
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function boot() {
  const loadingUI = new LoadingUI();
  await loadingUI.waitForBegin();
  await runLoadPipeline(loadingUI);
}

boot();
