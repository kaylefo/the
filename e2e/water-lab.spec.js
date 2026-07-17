import { test, expect } from "@playwright/test";

const LOAD_TIMEOUT_MS = 120_000;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__E2E__ = true;
  });
});

async function beginAndWaitForSim(page) {
  await page.goto("/water.html?e2e=1");
  await expect(page.getByTestId("water-begin-btn")).toBeVisible();
  await page.getByTestId("water-begin-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-sim-ready", "true", {
    timeout: LOAD_TIMEOUT_MS,
  });
  await expect(page.locator("#loading")).toHaveClass(/hidden/, { timeout: 10_000 });
}

test.describe("Water Physics Lab — mobile-first E2E", () => {
  test("pre-load shell: tap gate, canvas, responsive controls", async ({ page, isMobile }) => {
    await page.goto("/water.html?e2e=1");

    await expect(page.getByTestId("sim-canvas")).toBeVisible();
    await expect(page.getByTestId("water-begin-btn")).toBeVisible();
    if (isMobile) {
      await expect(page.getByTestId("hud-toggle")).toBeVisible();
    }
    await expect(page.getByTestId("hud")).toBeVisible();

    if (isMobile) {
      await expect(page.getByTestId("hud")).toHaveClass(/collapsed/);
      await expect(page.locator("#controls-mobile")).toBeVisible();
      await expect(page.locator("#controls-desktop")).toBeHidden();
    } else {
      await expect(page.locator("#controls-desktop")).toBeVisible();
      await expect(page.locator("#controls-mobile")).toBeHidden();
    }
  });

  test.describe.configure({ mode: "serial" });

  test("full simulation integration", async ({ page, isMobile }) => {
    await beginAndWaitForSim(page);

    await expect
      .poll(async () => page.evaluate(() => window.__waterLab?.getDiagnostics?.()?.water?.markers ?? 0), {
        timeout: 20_000,
      })
      .toBeGreaterThan(50);

    const diag = await page.evaluate(() => window.__waterLab.getDiagnostics());
    expect(diag.running).toBe(true);
    expect(diag.water.markers).toBeGreaterThan(50);
    expect(diag.water.volumeL).toBeGreaterThan(0);
    expect(diag.water.apicEnabled).toBe(true);
    expect(typeof diag.water.pressureResidual).toBe("number");
    expect(diag.frame).toBeGreaterThan(0);

    if (isMobile) {
      const hud = page.getByTestId("hud");
      const toggle = page.getByTestId("hud-toggle");
      await expect(hud).toHaveClass(/collapsed/);
      await toggle.click();
      await expect(hud).not.toHaveClass(/collapsed/);
      await toggle.click();
      await expect(hud).toHaveClass(/collapsed/);
    }

    const beforeFrame = diag.frame;
    const canvas = page.getByTestId("sim-canvas");
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.up();

    await expect
      .poll(async () => page.evaluate(() => window.__waterLab.getDiagnostics().frame), {
        timeout: 10_000,
      })
      .toBeGreaterThan(beforeFrame);

    if (isMobile) {
      await page.getByTestId("hud-toggle").click({ force: true });
    }

    const baseline = await page.evaluate(() => {
      const w = window.__waterLab.water.getDiagnostics();
      return { markers: w.markers, volumeL: w.volumeL };
    });

    await page.evaluate(() => window.__waterLab.resetTank());
    await expect
      .poll(async () => page.evaluate(() => window.__waterLab.water.getDiagnostics().markers), {
        timeout: 10_000,
      })
      .toBeGreaterThan(50);

    const reset = await page.evaluate(() => window.__waterLab.water.getDiagnostics());
    expect(Math.abs(reset.volumeL - baseline.volumeL)).toBeLessThan(0.5);
  });

  test("index page links to Water Lab", async ({ page }) => {
    await page.goto("/index.html");
    const link = page.getByRole("link", { name: "Water Lab" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "water.html");
  });
});
