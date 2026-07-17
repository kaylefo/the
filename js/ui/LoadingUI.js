/** Loading overlay: tap-to-begin gate, percent bar, stage log. */
export class LoadingUI {
  constructor() {
    this.gate = document.getElementById("loading-gate");
    this.progressPanel = document.getElementById("loading-progress");
    this.beginBtn = document.getElementById("begin-btn");
    this.percentEl = document.getElementById("load-percent");
    this.barFill = document.getElementById("load-bar-fill");
    this.textEl = document.getElementById("loading-text");
    this.metricsEl = document.getElementById("loading-metrics");
    this.loadingRoot = document.getElementById("loading");
  }

  /** Wait for explicit user gesture before starting WebGL / heavy work. */
  waitForBegin() {
    return new Promise((resolve) => {
      let done = false;
      const start = () => {
        if (done) return;
        done = true;
        this.beginBtn?.removeEventListener("click", start);
        this.gate?.setAttribute("hidden", "");
        this.progressPanel?.removeAttribute("hidden");
        resolve();
      };

      // The inline bootstrap in index.html wires the button before this module
      // finishes loading, so the tap is never missed on slow connections.
      // If the user already tapped, proceed immediately; otherwise let the
      // bootstrap notify us via the __onBegin hook.
      if (typeof window !== "undefined") {
        if (window.__beginRequested) {
          start();
          return;
        }
        window.__onBegin = start;
      }

      // Defensive fallback: also listen directly, in case the inline
      // bootstrap did not run for some reason.
      this.beginBtn?.addEventListener("click", start);
    });
  }

  bind(loader) {
    loader.onUpdate = (mgr) => this.render(mgr);
  }

  render(loader) {
    const pct = loader.getPercent();
    const label = loader.getCurrentLabel();

    if (this.percentEl) this.percentEl.textContent = `${pct}%`;
    if (this.barFill) this.barFill.style.width = `${pct}%`;
    const bar = document.querySelector(".load-bar");
    if (bar) bar.setAttribute("aria-valuenow", String(pct));
    if (this.textEl) this.textEl.textContent = label;

    if (this.metricsEl) {
      this.metricsEl.innerHTML = loader.metrics
        .map((m) => {
          const icon = m.ok ? "✓" : "✗";
          const cls = m.ok ? "metric-ok" : "metric-fail";
          const err = m.error ? ` — ${m.error}` : "";
          return `<li class="${cls}"><span class="metric-icon">${icon}</span> ${m.label} <span class="metric-ms">${m.durationMs}ms</span>${err}</li>`;
        })
        .join("");

      if (loader.currentStage) {
        const pending = loader.currentStage.label;
        this.metricsEl.innerHTML += `<li class="metric-active">… ${pending}</li>`;
      }
    }
  }

  showError(message, detail, report) {
    if (document.body?.dataset?.simReady === "true") return;
    if (!this.loadingRoot) return;
    this.loadingRoot.classList.remove("hidden");
    this.gate?.setAttribute("hidden", "");
    this.progressPanel?.removeAttribute("hidden");

    const metricsHtml = report?.stages?.length
      ? `<ul id="loading-metrics" class="error-metrics">${report.stages
          .map(
            (m) =>
              `<li class="${m.ok ? "metric-ok" : "metric-fail"}">${m.ok ? "✓" : "✗"} ${m.label} (${m.durationMs}ms)</li>`
          )
          .join("")}</ul>`
      : "";

    this.loadingRoot.innerHTML = `
      <div class="error-panel">
        <h2>Unable to start simulation</h2>
        <p>${message}</p>
        ${detail ? `<p class="error-detail">${detail}</p>` : ""}
        ${metricsHtml}
        <button type="button" onclick="location.reload()">Retry</button>
      </div>
    `;
  }

  hide() {
    this.loadingRoot?.classList.add("hidden");
  }
}

export function publishLoadReport(report) {
  window.__loadReport = report;
  window.__loadMetrics = report.stages;
  console.table(report.stages.map((s) => ({
    stage: s.id,
    label: s.label,
    ms: s.durationMs,
    ok: s.ok,
    pct: s.percentAfter,
  })));
  console.log(`[TomatoLoad] Complete in ${report.totalMs}ms (${report.percent}%)`);
}
