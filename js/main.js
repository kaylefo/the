import { probeWebGL, showFatalError, updateLoadingProgress } from "./platform/WebGLProbe.js";
import { createSimulation } from "./TomatoSimulation.js";

async function boot() {
  updateLoadingProgress("Checking WebGL…");
  const glInfo = probeWebGL();
  if (!glInfo.supported) {
    showFatalError(
      "Your browser does not support WebGL, which is required for the 3D simulation.",
      "Try updating iOS/Safari or use Chrome/Firefox on desktop."
    );
    return;
  }

  updateLoadingProgress("Detecting device & selecting quality tier…");

  const canvas = document.getElementById("canvas");
  if (!canvas) {
    showFatalError("Canvas element not found.");
    return;
  }

  try {
    const sim = await createSimulation(canvas);
    sim.start();
  } catch (err) {
    console.error(err);
    showFatalError(
      "The simulation failed to start.",
      err?.message ?? "Unknown error"
    );
  }
}

boot();
