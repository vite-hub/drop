// node build.mjs lesson.md lesson.html [--shots dir] [--assets dir]
// Checks lesson.md with the page's own parser (assets/lesson.js), then writes one HTML page: assets/page.html with the
// lesson, the styles and the scripts in its slots. With --shots, it opens the page in Chromium and saves every step in
// light and dark, plus the first step on a phone, and fails when the page, the editor or a preview throws.
// --assets reads the template from another folder, such as a copy you changed for this lesson.
// It needs nothing installed; --shots needs playwright.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return null;
  const [, value] = args.splice(at, 2);
  return resolve(value ?? "");
};
const shots = option("--shots");
const assets = option("--assets") ?? join(here, "../assets");
const [input, output] = args;
if (!input || !output) {
  console.error("Usage: node build.mjs lesson.md lesson.html [--shots dir] [--assets dir]");
  process.exit(2);
}

const read = (name) => readFileSync(join(assets, name), "utf8");
const source = readFileSync(input, "utf8");
const context = vm.createContext({});
vm.runInContext(`${read("lesson.js")}\nthis.parseLesson = parseLesson;`, context);
const lesson = context.parseLesson(source);
for (const w of lesson.warnings) console.log(`warning  ${w}`);
for (const e of lesson.errors) console.log(`error    ${e}`);
if (lesson.errors.length) {
  console.log(`\n${lesson.errors.length} errors. Fix lesson.md and build again.`);
  process.exit(1);
}

// The same page an agent without Node fills by hand: each part goes in its slot.
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const script = (text) => JSON.stringify(text).replace(/</g, "\\u003c");
const fill = (id, text) => [new RegExp(`(<(\\w+) id="${id}"[^>]*>)[\\s\\S]*?(</\\2>)`), text];
const slots = [
  [/(<(title)>)[\s\S]*?(<\/title>)/, esc(lesson.title)],
  fill("ca-style", `\n${read("style.css")}`),
  fill("lesson", `\n${script(source)}`),
  fill("ca-lesson", `\n${script(read("lesson.js"))}`),
  fill("ca-app", `\n${script(read("app.js"))}`),
];
let html = read("page.html");
for (const [slot, text] of slots) {
  if (!slot.test(html)) throw new Error(`page.html lost its ${slot} slot.`);
  html = html.replace(slot, (...m) => `${m[1]}${text}${m[3]}`);
}
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(output, html);
const fileCount = new Set(lesson.steps.flatMap((s) => Object.keys(s.files))).size;
console.log(
  `Wrote ${output} (${(html.length / 1024).toFixed(0)} kB, ${lesson.steps.length} steps, ${fileCount} files).`,
);

if (shots) {
  mkdirSync(shots, { recursive: true });
  const local = createRequire(join(process.cwd(), "noop.js"));
  let path;
  try {
    path = local.resolve("playwright");
  } catch {
    console.log("error    --shots needs playwright: run the build where it's installed (npm i playwright).");
    process.exit(1);
  }
  const playwright = await import(pathToFileURL(path).href);
  const { chromium } = playwright.chromium ? playwright : playwright.default;
  // Playwright's own browser may be missing; fall back to the newest one in its cache.
  const cache = join(homedir(), ".cache/ms-playwright");
  const fallback = existsSync(cache)
    ? readdirSync(cache)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
        .map((d) => join(cache, d, "chrome-linux64/chrome"))
        .find((p) => existsSync(p))
    : undefined;
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    browser = fallback ? await chromium.launch({ executablePath: fallback }).catch(() => null) : null;
    if (!browser) {
      console.log(
        `error    --shots couldn't start Chromium: ${error.message.split("\n")[0]}\n         Run \`npx playwright install chromium\` where you build.`,
      );
      process.exit(1);
    }
  }
  const problems = [];
  const url = pathToFileURL(resolve(output)).href;
  const views = [
    { name: "light", theme: "light", viewport: { width: 1440, height: 900 } },
    { name: "dark", theme: "dark", viewport: { width: 1440, height: 900 } },
    { name: "phone", theme: "light", viewport: { width: 390, height: 844 }, first: true },
  ];
  for (const view of views) {
    const page = await browser.newPage({ viewport: view.viewport, deviceScaleFactor: view.first ? 2 : 1 });
    page.on("pageerror", (e) => problems.push(`${view.name}: page error: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "warning" && /code-along:/.test(m.text())) problems.push(`${view.name}: ${m.text()}`);
    });
    await page.goto(`${url}?theme=${view.theme}`);
    await page
      .waitForFunction(() => document.body.dataset.ready, null, { timeout: 30000 })
      .catch(() => problems.push(`${view.name}: the page didn't finish loading in 30 s`));
    await page.evaluate(() => document.fonts.ready);
    const ids = view.first ? lesson.steps.slice(0, 1).map((s) => s.id) : lesson.steps.map((s) => s.id);
    for (const [index, id] of ids.entries()) {
      await page.evaluate((v) => window.__lesson?.go(v), id);
      const step = lesson.steps[index];
      if (step.files["index.html"]) {
        const status = await page
          .waitForFunction(() => {
            const state = document.querySelector(".ca-shell")?.dataset.preview;
            return state === "ready" || state === "failed" ? state : null;
          }, null, {
            timeout: 15000,
          })
          .then((result) => result.jsonValue(), () => "timeout");
        const errors = await page.$$eval(".ca-log.is-error", (rows) => rows.map((r) => r.textContent));
        for (const e of errors) problems.push(`${view.name}: step "${step.title}": the preview logged an error: ${e}`);
        if (status !== "ready") {
          problems.push(`${view.name}: step "${step.title}": ${status === "timeout" ? "the preview didn't finish in 15 s" : "the preview failed"}`);
          continue;
        }
        if (errors.length) continue;
      } else await page.waitForTimeout(150);
      await page.screenshot({ path: join(shots, `${String(index + 1).padStart(2, "0")}-${id}-${view.name}.png`) });
    }
    await page.close();
  }
  await browser.close();
  for (const p of problems) console.log(`error    ${p}`);
  if (problems.length) {
    console.log(`\n${problems.length} problems in the screenshots run. Fix them and build again.`);
    process.exit(1);
  }
  console.log(`Saved screenshots in ${shots}.`);
}
