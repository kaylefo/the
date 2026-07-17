import { probeWebGL, showFatalError, updateLoadingProgress, yieldToMain } from "./platform/WebGLProbe.js";
import { createSimulation } from "./TomatoSimulation.js";

const LOAD_TIMEOUT_MS = 45000;

function installGlobalErrorHandlers() {
  window.addEventListener("error", (e) => {
    if (e.message?.includes("Import") || e.filename?.includes(".js")) {
      showFatalError(
        "Failed to load simulation scripts.",
        e.message || "Check your network connection and try again."
      );
    }
  });
  window.addEventListener("unhandledrejection", (e) => {
    showFatalError(
      "The simulation failed to start.",
      e.reason?.message ?? String(e.reason ?? "Unknown error")
    );
  });
}

async function boot() {
  installGlobalErrorHandlers();

  const timeout = setTimeout(() => {
    showFatalError(
      "Loading is taking longer than expected.",
      "Try refreshing. On older phones, wait up to a minute for first load."
    );
  }, LOAD_TIMEOUT_MS);

  try {
    updateLoadingProgress("Checking WebGL…");
    await yieldToMain();

    const glInfo = probeWebGL();
    if (!glInfo.supported) {
      showFatalError(
        "Your browser does not support WebGL, which is required for the 3D simulation.",
        "Try updating iOS/Safari or use Chrome/Firefox on desktop."
      );
      return;
    }

    updateLoadingProgress("Detecting device & selecting quality tier…");
    await yieldToMain();

    const canvas = document.getElementById("canvas");
    if (!canvas) {
      showFatalError("Canvas element not found.");
      return;
    }

    const sim = await createSimulation(canvas, updateLoadingProgress);
    sim.start();
  } catch (err) {
    console.error(err);
    showFatalError(
      "The simulation failed to start.",
      err?.message ?? "Unknown error"
    );
  } finally {
    clearTimeout(timeout);
  }
}

boot();
