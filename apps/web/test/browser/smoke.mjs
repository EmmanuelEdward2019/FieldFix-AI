#!/usr/bin/env node
/**
 * Headless-browser smoke + visual checks (playwright-core + system Chrome).
 *
 * Boots production servers when they are not already running, walks the
 * public landing page and the full guest demo flow in a real browser,
 * asserts auth/admin gates, responsive overflow, and the theme toggle,
 * fails on any console/page error, and saves screenshots for review.
 *
 *   npm run test:browser -w @fieldfix/web
 *
 * Env: WEB_URL (default http://localhost:3000 — must match the API's
 *      CORS_ORIGIN and the baked NEXT_PUBLIC_API_URL host),
 *      API_URL (default http://localhost:3001),
 *      CHROME_PATH (default: macOS Chrome, then common Linux paths),
 *      BROWSER_OUT (default apps/web/test-results/browser).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "../..");
const apiDir = path.resolve(webDir, "../api");
const repoRoot = path.resolve(webDir, "../..");

const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";
const API_URL = process.env.API_URL ?? "http://localhost:3001";
const OUT_DIR =
  process.env.BROWSER_OUT ?? path.join(webDir, "test-results", "browser");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function resolveChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `No Chrome/Chromium binary found (tried ${CHROME_CANDIDATES.join(", ")}). ` +
      "Set CHROME_PATH to a Chrome executable.",
  );
}

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`)),
    );
    child.on("error", reject);
  });
}

const spawned = [];

async function ensureServers() {
  const webUp = await reachable(`${WEB_URL}/`);
  const apiUp = await reachable(`${API_URL}/health`);
  if (webUp && apiUp) {
    console.log("servers: reusing already-running web + api");
    return;
  }
  // Production builds are required for a faithful check.
  if (!existsSync(path.join(webDir, ".next", "BUILD_ID"))) {
    console.log("servers: building web…");
    await run("npm", ["run", "build", "-w", "@fieldfix/web"], repoRoot);
  }
  if (!existsSync(path.join(apiDir, "dist", "index.js"))) {
    console.log("servers: building api…");
    await run("npm", ["run", "build", "-w", "@fieldfix/api"], repoRoot);
  }
  if (!apiUp) {
    console.log("servers: starting api…");
    spawned.push(spawn("npm", ["run", "start"], { cwd: apiDir, stdio: "pipe" }));
  }
  if (!webUp) {
    console.log("servers: starting web…");
    spawned.push(
      spawn("npm", ["run", "start", "--", "--port", "3000", "--hostname", "127.0.0.1"], {
        cwd: webDir,
        stdio: "pipe",
        env: { ...process.env, NEXT_PUBLIC_API_URL: API_URL },
      }),
    );
  }
  const deadline = Date.now() + 120_000;
  for (;;) {
    const ready =
      (webUp || (await reachable(`${WEB_URL}/`))) &&
      (apiUp || (await reachable(`${API_URL}/health`)));
    if (ready) {
      console.log("servers: ready");
      return;
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for web/api servers to come up.");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function stopSpawned() {
  for (const child of spawned) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/**
 * New context with per-check console/page error capture. `ignore`
 * drops one narrowly-matched benign message (used only where a check
 * deliberately provokes an HTTP error status); everything else fails.
 */
async function checkedContext(browser, options = {}, ignore = null) {
  const problems = [];
  const context = await browser.newContext(options);
  context.on("page", (page) => {
    page.on("pageerror", (err) => problems.push(`pageerror: ${String(err).slice(0, 300)}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = `console.error: ${msg.text().slice(0, 300)}`;
        if (!ignore || !ignore(text)) {
          problems.push(text);
        }
      }
    });
  });
  return { context, problems };
}

const results = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, detail: String(err && err.message ? err.message : err) });
    console.log(`  FAIL ${name} — ${results[results.length - 1].detail}`);
  }
}

function assertProblems(problems) {
  if (problems.length > 0) {
    throw new Error(`browser errors:\n    - ${problems.join("\n    - ")}`);
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const executablePath = resolveChrome();
  await ensureServers();
  const browser = await chromium.launch({ executablePath });

  try {
    // 1. Landing page renders with no errors.
    await check("landing renders", async () => {
      const { context, problems } = await checkedContext(browser, {
        viewport: { width: 1440, height: 900 },
      });
      try {
        const page = await context.newPage();
        await page.goto(WEB_URL, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: "Show the device." }).waitFor();
        await page.getByRole("link", { name: "Explore the demo" }).waitFor();
        await page.screenshot({ path: path.join(OUT_DIR, "01-landing.png") });
        assertProblems(problems);
        return "hero + demo CTA visible";
      } finally {
        await context.close();
      }
    });

    // 2. Full guest demo flow: wizard → loader → workspace report.
    await check("demo wizard end-to-end", async () => {
      const { context, problems } = await checkedContext(browser, {
        viewport: { width: 1440, height: 900 },
      });
      try {
        const page = await context.newPage();
        await page.goto(`${WEB_URL}/demo/new`, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: "What are you fixing?" }).waitFor();
        await page.screenshot({ path: path.join(OUT_DIR, "02-wizard-device.png") });
        await page.getByRole("button", { name: /laptop/i }).click();
        await page.getByRole("button", { name: /continue/i }).click();
        await page.getByRole("heading", { name: "What kind of problem is it?" }).waitFor();
        await page.getByRole("button", { name: /power & startup/i }).click();
        await page.getByRole("button", { name: /continue/i }).click();
        await page.locator("#wizard-symptoms").waitFor();
        await page.locator("#wizard-symptoms").fill(
          "Browser-check fixture: the laptop will not power on.",
        );
        await page.getByRole("button", { name: /continue/i }).click();
        await page.getByRole("heading", { name: "Ready to start?" }).waitFor();
        await page.screenshot({ path: path.join(OUT_DIR, "03-wizard-review.png") });
        await page.getByRole("button", { name: /start sample diagnosis/i }).click();
        await page
          .locator('[aria-label^="Running sample analysis"]')
          .waitFor({ timeout: 10_000 });
        await page.screenshot({ path: path.join(OUT_DIR, "04-analysis-loader.png") });
        await page.waitForURL("**/demo/workspace**", { timeout: 30_000 });
        await page.locator("#demo-report-title").waitFor({ timeout: 30_000 });
        await page.screenshot({ path: path.join(OUT_DIR, "05-demo-report.png") });
        assertProblems(problems);
        return "loader → workspace → repair report";
      } finally {
        await context.close();
      }
    });

    // 3. Protected routes gate anonymous visitors.
    await check("diagnostics requires sign-in", async () => {
      const { context, problems } = await checkedContext(browser);
      try {
        const page = await context.newPage();
        await page.goto(`${WEB_URL}/diagnostics/new`, { waitUntil: "networkidle" });
        await page.waitForURL("**/login**", { timeout: 10_000 });
        assertProblems(problems);
        return "redirected to /login";
      } finally {
        await context.close();
      }
    });

    // 4. Admin console shows the sign-in gate (never a crash).
    await check("admin sign-in gate renders", async () => {
      const { context, problems } = await checkedContext(browser);
      try {
        const page = await context.newPage();
        await page.goto(`${WEB_URL}/admin`, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: /admin console/i }).waitFor();
        const signIn = page.getByRole("link", { name: /^sign in$/i });
        await signIn.waitFor();
        const href = await signIn.getAttribute("href");
        if (href !== "/login?next=/admin") {
          throw new Error(`gate links to ${href ?? "(missing)"}, want /login?next=/admin`);
        }
        await page.screenshot({ path: path.join(OUT_DIR, "06-admin-gate.png") });
        assertProblems(problems);
        return "sign-in gate visible";
      } finally {
        await context.close();
      }
    });

    // 5. Theme toggle flips the document theme.
    await check("theme toggle works", async () => {
      const { context, problems } = await checkedContext(browser);
      try {
        const page = await context.newPage();
        await page.goto(`${WEB_URL}/demo/new`, { waitUntil: "networkidle" });
        const before = await page.evaluate(() => document.documentElement.dataset.theme);
        await page.getByRole("button", { name: /^switch to (light|dark) theme$/i }).click();
        await page.waitForFunction(
          (prev) => document.documentElement.dataset.theme !== prev,
          before,
          { timeout: 5000 },
        );
        const after = await page.evaluate(() => document.documentElement.dataset.theme);
        const stored = await page.evaluate(() => localStorage.getItem("fieldfix.theme"));
        if (stored !== after) {
          throw new Error(`theme not persisted (dom=${after}, stored=${stored})`);
        }
        assertProblems(problems);
        return `data-theme "${before}" → "${after}" (persisted)`;
      } finally {
        await context.close();
      }
    });

    // 6. Credential fields are password-manager friendly (names).
    await check("auth forms expose manager names", async () => {
      const { context, problems } = await checkedContext(browser);
      try {
        const page = await context.newPage();
        const fields = [
          ["/login", "#login-email", "email"],
          ["/login", "#login-password", "password"],
          ["/register", "#register-email", "email"],
          ["/register", "#register-password", "new-password"],
          ["/reset-password", "#reset-password", "new-password"],
          ["/forgot-password", "#forgot-email", "email"],
        ];
        for (const [route, selector, expected] of fields) {
          await page.goto(`${WEB_URL}${route}`, { waitUntil: "networkidle" });
          const name = await page.locator(selector).getAttribute("name");
          if (name !== expected) {
            throw new Error(`${route} ${selector} has name=${name ?? "(missing)"}`);
          }
        }
        assertProblems(problems);
        return `${fields.length} fields named`;
      } finally {
        await context.close();
      }
    });

    // 7. Admin console has no token login: user sessions only.
    await check("admin has no token login", async () => {
      const { context, problems } = await checkedContext(browser);
      try {
        const page = await context.newPage();
        await page.goto(`${WEB_URL}/admin`, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: /admin console/i }).waitFor();
        if ((await page.locator("#console-token").count()) !== 0) {
          throw new Error("legacy token field still present");
        }
        if ((await page.getByRole("button", { name: /unlock console/i }).count()) !== 0) {
          throw new Error("legacy unlock button still present");
        }
        const legacy = await page.evaluate(() => localStorage.getItem("fieldfix.admin"));
        if (legacy != null) {
          throw new Error("legacy token storage key still written");
        }
        await page.screenshot({ path: path.join(OUT_DIR, "08-admin-no-token.png") });
        assertProblems(problems);
        return "gate is sign-in only";
      } finally {
        await context.close();
      }
    });

    // 8. Mobile viewport has no horizontal overflow.
    await check("mobile has no horizontal overflow", async () => {
      const { context, problems } = await checkedContext(browser, {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      try {
        const page = await context.newPage();
        await page.goto(`${WEB_URL}/demo`, { waitUntil: "networkidle" });
        const overflow = await page.evaluate(
          () => document.scrollingElement.scrollWidth - window.innerWidth,
        );
        await page.screenshot({ path: path.join(OUT_DIR, "07-demo-mobile.png") });
        if (overflow > 1) {
          throw new Error(`horizontal overflow of ${overflow}px at 390px wide`);
        }
        assertProblems(problems);
        return "390px clean";
      } finally {
        await context.close();
      }
    });
  } finally {
    await browser.close();
    stopSpawned();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nbrowser checks: ${results.length - failed.length}/${results.length} passed; screenshots in ${OUT_DIR}`,
  );
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  stopSpawned();
  console.error(`browser checks aborted: ${err && err.message ? err.message : err}`);
  process.exitCode = 1;
});
