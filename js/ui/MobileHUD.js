/** Mobile-friendly HUD: collapse, quality badge, touch hints. */
export class MobileHUD {
  constructor(device) {
    this.device = device;
    this.collapsed = device.mobile;
    this._bind();
    this._applyCollapsedState();
    this._renderHints();
    this._updateQualityBadge(device.summary());
  }

  _applyCollapsedState() {
    const hud = document.getElementById("hud");
    const toggle = document.getElementById("hud-toggle");
    hud?.classList.toggle("collapsed", this.collapsed);
    toggle?.setAttribute("aria-expanded", String(!this.collapsed));
  }

  _bind() {
    const toggle = document.getElementById("hud-toggle");
    const hud = document.getElementById("hud");
    toggle?.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      hud?.classList.toggle("collapsed", this.collapsed);
      toggle.setAttribute("aria-expanded", String(!this.collapsed));
    });

    document.getElementById("drop-btn")?.addEventListener("click", () => {
      window.__tomatoSim?.dropTomato();
    });
    document.getElementById("reset-btn")?.addEventListener("click", () => {
      window.__tomatoSim?.resetTomato();
    });
  }

  _renderHints() {
    const desktop = document.getElementById("controls-desktop");
    const mobile = document.getElementById("controls-mobile");
    if (this.device.mobile) {
      desktop?.setAttribute("hidden", "");
      mobile?.removeAttribute("hidden");
    } else {
      mobile?.setAttribute("hidden", "");
      desktop?.removeAttribute("hidden");
    }
  }

  _updateQualityBadge(summary) {
    const badge = document.getElementById("quality-badge");
    if (!badge) return;
    badge.textContent = `${summary.label}${summary.proMaxClass ? " · Pro Max" : ""}`;
    badge.title = `Grid ${summary.grid}³ · DPR ${summary.pixelRatio.toFixed(1)} · ${summary.webgl2 ? "WebGL2" : "WebGL1"}`;
  }

  setQuality(summary) {
    this._updateQualityBadge(summary);
  }

  setPaused(paused) {
    document.getElementById("hud")?.classList.toggle("paused", paused);
  }
}
