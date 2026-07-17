/** WebGL capability probe and graceful error UI. */
export function probeWebGL() {
  const canvas = document.createElement("canvas");
  const errors = [];

  let gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: true,
    powerPreference: "high-performance",
  });

  if (gl) {
    return { gl: null, webgl2: true, supported: true, errors };
  }

  gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  if (gl) {
    return { gl: null, webgl2: false, supported: true, errors };
  }

  errors.push("WebGL is not available in this browser.");
  return { gl: null, webgl2: false, supported: false, errors };
}

export function showFatalError(message, detail = "") {
  const loading = document.getElementById("loading");
  if (loading) {
    loading.classList.remove("hidden");
    loading.innerHTML = `
      <div class="error-panel">
        <h2>Unable to start simulation</h2>
        <p>${message}</p>
        ${detail ? `<p class="error-detail">${detail}</p>` : ""}
        <button type="button" onclick="location.reload()">Retry</button>
      </div>
    `;
  }
}

export function updateLoadingProgress(text) {
  const el = document.getElementById("loading-text");
  if (el) el.textContent = text;
}

export function yieldToMain() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}
