// Checks a report.json before it's built. Every issue names where it is and how to fix it.

const LIMITS = {
  title: 40,
  subtitle: 60,
  intro: 280,
  label: 22,
  summary: 140,
  blockTitle: 60,
  note: 120,
  method: 1600,
  statLabel: 28,
  hint: 32,
  fact: 110,
};
const KEYS = {
  report: [
    "title",
    "subtitle",
    "intro",
    "source",
    "updated",
    "filters",
    "search",
    "top",
    "views",
    "bottom",
    "method",
    "data",
  ],
  filter: ["field", "label", "type", "default", "options", "count", "countField", "colors"],
  view: ["id", "label", "summary", "blocks"],
  stats: ["type", "items", "id", "title", "note"],
  stat: ["label", "value", "format", "unit", "delta", "deltaFormat", "good", "hint"],
  facts: ["type", "items", "id", "title", "note"],
  fact: ["value", "format", "text"],
  chart: [
    "type",
    "chart",
    "title",
    "note",
    "data",
    "x",
    "y",
    "series",
    "names",
    "labels",
    "value",
    "size",
    "label",
    "labelTop",
    "format",
    "height",
    "wide",
    "half",
    "horizontal",
    "stack",
    "limit",
    "sort",
    "highlight",
    "emphasis",
    "tones",
    "endValues",
    "points",
    "yMax",
    "logX",
    "logY",
    "logToggle",
    "xTitle",
    "yTitle",
    "xType",
    "xFormat",
    "bins",
    "curve",
    "tint",
    "scale",
    "columns",
    "id",
  ],
  bars: [
    "type",
    "title",
    "note",
    "data",
    "label",
    "value",
    "segments",
    "names",
    "tones",
    "end",
    "format",
    "percent",
    "sort",
    "limit",
    "wide",
    "half",
    "id",
  ],
  matrix: [
    "type",
    "title",
    "note",
    "data",
    "x",
    "y",
    "value",
    "columns",
    "tint",
    "tones",
    "scale",
    "format",
    "wide",
    "half",
    "id",
  ],
  table: [
    "type",
    "title",
    "note",
    "data",
    "columns",
    "style",
    "header",
    "sort",
    "limit",
    "more",
    "search",
    "rank",
    "wide",
    "half",
    "id",
  ],
  column: [
    "field",
    "label",
    "format",
    "number",
    "fields",
    "names",
    "tones",
    "colorBy",
    "truncate",
    "suffix",
  ],
  vega: ["type", "title", "note", "spec", "height", "wide", "half", "id"],
};
const TYPES = ["stats", "facts", "chart", "bars", "matrix", "table", "vega"];
const CHARTS = ["line", "area", "bar", "stacked", "grouped", "scatter", "heatmap", "histogram"];
const FORMATS = ["number", "integer", "compact", "percent", "money"];
const COLUMN_FORMATS = [
  "text",
  "entity",
  "user",
  "country",
  "link",
  "date",
  "bar",
  "heat",
  "stack",
  "chips",
  "delta",
  ...FORMATS,
];
// The same pattern as CATCH_ALL in assets/app.js: values the template sorts last and grays.
export const CATCH_ALL =
  /^(not set|unset|not given|unknown|none|n\/a|missing|unspecified|blank|empty|no [\w ]+|others?\b.*|rest of .+|the rest|everyone else|everything else|all others|\(.*\)|[-–—?])$/i;
const NUMERIC = ["number", "integer", "compact", "percent", "money", "bar", "heat", "delta"];
const TONE_NAMES = ["good", "fair", "warn", "bad", "muted", "accent"];
const MAX_SERIES = 12;

const sentences = (s) => (String(s).match(/[.!?](\s|$)/g) ?? []).length;

// The first and last day of the period a value names ("2026", 2026, "2026-11", "2026-Q4", "2026 to Nov 11"), or null.
const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const periodOf = (v) => {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})(?!-\d)/);
  if (m) return [day(+m[1], +m[2], 1), day(+m[1], +m[2] + 1, 0)];
  m = s.match(/^(\d{4})[- ]?Q([1-4])\b/i);
  if (m) return [day(+m[1], m[2] * 3 - 2, 1), day(+m[1], m[2] * 3 + 1, 0)];
  m = s.match(/^(\d{4})(?![-\d])/);
  if (m && +m[1] > 1900 && +m[1] < 2200) return [day(+m[1], 1, 1), day(+m[1], 12, 31)];
  return null;
};

export function check(report) {
  const errors = [];
  const warnings = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
  const keys = (obj, kind, where) => {
    for (const k of Object.keys(obj ?? {}))
      if (!KEYS[kind].includes(k))
        err(
          where,
          `\`${k}\` isn't a ${kind} option. The options are ${KEYS[kind].map((x) => `\`${x}\``).join(", ")}.`,
        );
  };
  const text = (value, limit, where, what, one) => {
    if (value == null) return;
    if (typeof value !== "string") return err(where, `${what} must be text.`);
    if (value.length > limit)
      err(
        where,
        `${what} is ${value.length} characters; the limit is ${limit}. Keep the one thing the reader needs and move the rest to \`method\`.`,
      );
    if (one && sentences(value) > 1)
      err(
        where,
        `${what} has ${sentences(value)} sentences; write one. Put the rest in \`method\` or let a block show it.`,
      );
  };
  const tones = (list, where) => {
    for (const t of list ?? [])
      if (typeof t === "string" && !t.startsWith("#") && !TONE_NAMES.includes(t))
        err(
          where,
          `tone \`${t}\` isn't one of ${TONE_NAMES.join(", ")}, a palette index, or a #hex color.`,
        );
  };

  keys(report, "report", "report");
  if (!report.title)
    err(
      "report",
      "add a `title`: the product-like name in the top bar, like `shoplens` or `Who builds Nuxt`.",
    );
  text(report.title, LIMITS.title, "report", "`title`");
  text(report.subtitle, LIMITS.subtitle, "report", "`subtitle`");
  text(report.intro, LIMITS.intro, "report", "`intro`");
  if (report.intro && sentences(report.intro) > 2)
    err(
      "report",
      "`intro` has more than two sentences; say what the report answers and where the data comes from, nothing else.",
    );
  text(report.method, LIMITS.method, "report", "`method`");
  if (report.source && (!report.source.label || !report.source.url))
    err("report.source", "give both `label` and `url`.");

  const data = report.data ?? {};
  if (!Object.keys(data).length)
    err("report", "add `data`: one array of rows per dataset, keyed by name.");
  let total = 0;
  for (const [name, rows] of Object.entries(data)) {
    if (
      !Array.isArray(rows) ||
      rows.some((r) => typeof r !== "object" || r === null || Array.isArray(r))
    )
      err(`data.${name}`, "must be an array of row objects.");
    else total += rows.length;
  }
  const size = JSON.stringify(data).length;
  if (size > 3_000_000)
    err(
      "data",
      `is ${(size / 1e6).toFixed(1)} MB; aggregate it in the prep script so the page stays under 3 MB.`,
    );
  else if (total > 20000)
    warn(
      "data",
      `${total} rows in all; aggregate in the prep script unless a table needs every row.`,
    );
  const fieldsOf = (name) => {
    const set = new Set();
    for (const r of data[name] ?? []) for (const k of Object.keys(r)) set.add(k);
    return set;
  };
  const needData = (name, where) => {
    if (!name) return err(where, "add `data`: the name of a dataset.") ?? false;
    if (!(name in data))
      return (
        err(
          where,
          `there's no dataset \`${name}\`. The datasets are ${Object.keys(data)
            .map((x) => `\`${x}\``)
            .join(", ")}.`,
        ) ?? false
      );
    return true;
  };
  const needField = (name, f, where, what) => {
    if (f == null) return;
    const fields = fieldsOf(name);
    for (const one of Array.isArray(f) ? f : [f])
      if (!fields.has(one))
        err(
          where,
          `${what} \`${one}\` isn't a field of \`${name}\`. Its fields are ${[...fields].map((x) => `\`${x}\``).join(", ")}.`,
        );
  };

  const listFields = new Set();
  for (const [i, f] of (report.filters ?? []).entries()) {
    const where = `filters[${i}]`;
    keys(f, "filter", where);
    if (f.type && !["tabs", "list", "toggle"].includes(f.type))
      err(
        where,
        "`type` must be `tabs` (a few periods or modes), `list` (names with a color and a count) or `toggle` (a checkbox in the top bar).",
      );
    if (!f.field) err(where, "add the `field` it filters on.");
    else if (!Object.values(data).some((rows) => rows.some?.((r) => f.field in r)))
      err(where, `no dataset has a \`${f.field}\` field, so this filter would do nothing.`);
    if (f.count) needData(f.count, where);
    if ((f.type ?? (f.options && f.options.length <= 5 ? "tabs" : "list")) === "list")
      listFields.add(f.field);
  }

  let escapes = 0;
  const checkBlock = (b, at) => {
    const kind = b.type;
    if (!TYPES.includes(kind))
      return err(at, `\`type\` must be one of ${TYPES.map((t) => `\`${t}\``).join(", ")}.`);
    keys(b, kind, at);
    text(b.title, LIMITS.blockTitle, at, "`title`");
    text(b.note, LIMITS.note, at, "`note`", true);
    if (b.note && !b.title)
      err(at, "a `note` shows under the block's `title`; add a `title` or drop the `note`.");
    if (kind === "stats" || kind === "facts") {
      const max = kind === "stats" ? 6 : 4;
      if (!b.items?.length) err(at, "add `items`.");
      if (b.items?.length > max)
        err(at, `has ${b.items.length} items; keep the ${max} or fewer that matter.`);
      for (const [si, s] of (b.items ?? []).entries()) {
        const w = `${at} > items[${si}]`;
        keys(s, kind === "stats" ? "stat" : "fact", w);
        if (kind === "stats") {
          text(s.label, LIMITS.statLabel, w, "`label`");
          text(s.hint, LIMITS.hint, w, "`hint`");
        } else {
          if (!s.text) err(w, "add `text`: one sentence that says what the number means.");
          text(s.text, LIMITS.fact, w, "`text`", true);
        }
        for (const slot of ["value", "delta"]) {
          const v = s[slot];
          if (v && typeof v === "object" && needData(v.data, `${w}.${slot}`)) {
            if (v.field == null && v.agg !== "count")
              err(`${w}.${slot}`, 'add `field`, or `"agg": "count"` to count the rows.');
            needField(v.data, v.field, `${w}.${slot}`, "`field`");
          }
        }
        if (s.format && !FORMATS.includes(s.format))
          err(w, `\`format\` must be one of ${FORMATS.join(", ")}.`);
      }
      return;
    }
    if (kind === "vega") {
      escapes++;
      if (!b.spec || typeof b.spec !== "object")
        err(at, 'add `spec`: a Vega-Lite spec whose `data` is `{ "name": "<dataset>" }`.');
      else if (b.spec.data?.name) needData(b.spec.data.name, at);
      warn(at, "is a raw Vega-Lite block. Use another block when one fits.");
      return;
    }
    if (!b.title && kind !== "table") err(at, "add a `title` that says what is measured.");
    if (!needData(b.data, at)) return;
    const rows = data[b.data] ?? [];
    tones(b.tones, at);
    if (b.format && !FORMATS.includes(b.format))
      err(at, `\`format\` must be one of ${FORMATS.join(", ")}.`);
    if (kind === "bars") {
      if (!b.label) err(at, "add `label`: the field that names each row.");
      if (!b.value && !b.segments)
        err(at, "add `value` (one number per row) or `segments` (fields that add up to the bar).");
      needField(b.data, b.label, at, "`label`");
      needField(b.data, b.value, at, "`value`");
      needField(b.data, b.segments, at, "`segments`");
      needField(b.data, b.end, at, "`end`");
      if (rows.length > 30 && !b.limit)
        err(at, `has ${rows.length} rows; set \`limit\` (at most 30) or use a table.`);
    }
    if (kind === "matrix" || (kind === "chart" && b.chart === "heatmap")) {
      needField(b.data, b.x, at, "`x`");
      needField(b.data, b.y, at, "`y`");
      needField(b.data, b.value, at, "`value`");
      if (b.tint && !["columns", "rows", "single"].includes(b.tint))
        err(
          at,
          "`tint` must be `columns` (each column in its value's color), `rows`, or `single`.",
        );
      const cols = new Set(rows.map((r) => r[b.x])).size;
      if (cols > 24) err(at, `has ${cols} columns; keep at most 24, or swap \`x\` and \`y\`.`);
      if (kind === "matrix") return;
    }
    if (kind === "chart") {
      if (!CHARTS.includes(b.chart))
        return err(at, `\`chart\` must be one of ${CHARTS.join(", ")}.`);
      if (b.chart === "heatmap") return;
      needField(b.data, b.x, at, "`x`");
      if (b.chart !== "histogram") needField(b.data, b.y, at, "`y`");
      needField(b.data, b.series, at, "`series`");
      needField(b.data, b.size, at, "`size`");
      needField(b.data, b.label, at, "`label`");
      if (!b.x) err(at, "add `x`.");
      if (!b.y && b.chart !== "histogram") err(at, "add `y`.");
      const series = Array.isArray(b.y)
        ? b.y.length
        : b.series
          ? new Set(rows.map((r) => r[b.series])).size
          : 1;
      if (series > MAX_SERIES)
        err(
          at,
          `has ${series} series; show at most ${MAX_SERIES}. Keep the largest and sum the rest into one "Other" series in the prep script, or use a matrix.`,
        );
      if (["bar", "stacked", "grouped"].includes(b.chart) && !b.limit) {
        const cats = new Set(rows.map((r) => r[b.x])).size;
        if (cats > 40)
          err(at, `has ${cats} bars; set \`limit\` to the top 10–25, or use a line or histogram.`);
      }
      if (b.stack != null && ["line", "scatter", "histogram"].includes(b.chart))
        err(at, "`stack` applies to area and bar charts; draw shares as an `area` chart.");
      if (b.horizontal && !["bar", "stacked", "grouped"].includes(b.chart))
        err(
          at,
          "`horizontal` only applies to bar, stacked and grouped charts; a `bars` block is often better.",
        );
    }
    if (kind === "table") {
      if (!b.columns?.length)
        err(at, "add `columns`: `{ field, label, format }` for each column to show, at most 9.");
      if (b.columns?.length > 9) err(at, `has ${b.columns.length} columns; keep at most 9.`);
      if (b.style && b.style !== "rows")
        err(
          at,
          '`style` can only be `"rows"`: a dense list for the evidence behind the numbers.',
        );
      const cols = b.columns ?? [];
      const numeric = cols.filter(
        (c) =>
          NUMERIC.includes(c.format) ||
          (!c.format && rows.some((r) => typeof r[c.field] === "number")),
      ).length;
      const needsHeader = cols.length > 5 || numeric > 1;
      if (b.header === false && needsHeader)
        err(
          at,
          `has ${numeric > 1 ? `${numeric} number columns` : `${cols.length} columns`}, which no one can tell apart without a header; remove \`header: false\`.`,
        );
      if (b.header ?? (b.style !== "rows" || needsHeader))
        for (const [ci, c] of cols.entries())
          if (!c.label)
            err(
              `${at} > columns[${ci}]`,
              `add a \`label\`: the table shows a header${b.style === "rows" ? ` (it has ${numeric > 1 ? "2 or more number columns" : "more than 5 columns"})` : ""}, and without one it prints the field name \`${c.field}\`.`,
            );
      // A partial period against a full one: 2026 to November against all of 2025 reads as a collapse.
      const updated = /^\d{4}-\d{2}-\d{2}$/.test(report.updated ?? "") ? report.updated : null;
      const periodField = cols
        .filter((c) => !NUMERIC.includes(c.format) && c.format !== "stack")
        .map((c) => c.field)
        .find((f) => rows.filter((r) => periodOf(r[f])).length * 2 >= rows.length && rows.length);
      for (const c of updated && periodField ? cols.filter((c) => c.format === "delta") : [])
        for (const r of rows) {
          const period = periodOf(r[periodField]);
          if (r[c.field] == null || !period || !(period[0] <= updated && updated < period[1]))
            continue;
          warn(
            at,
            `the \`${c.field}\` of "${r[periodField]}" compares a period that \`updated\` (${updated}) cuts short with a full one, so the change mostly measures the missing months. Leave it empty, and compare a trailing full window instead, like the last 12 months against the full year before.`,
          );
        }
      for (const [ci, c] of (b.columns ?? []).entries()) {
        const w = `${at} > columns[${ci}]`;
        keys(c, "column", w);
        if (c.format === "stack") {
          if (!c.fields?.length)
            err(
              w,
              "a `stack` column needs `fields`: the numeric fields that make up the little bar.",
            );
          needField(b.data, c.fields, w, "`fields`");
          tones(c.tones, w);
        } else needField(b.data, c.field, w, "`field`");
        if (c.format && !COLUMN_FORMATS.includes(c.format))
          err(w, `\`format\` must be one of ${COLUMN_FORMATS.join(", ")}.`);
        if (c.format === "entity" && !listFields.has(c.field))
          warn(
            w,
            `\`entity\` shows a colored dot only for a field with a list filter; \`${c.field}\` has none.`,
          );
        if (c.suffix) needField(b.data, c.suffix, w, "`suffix`");
      }
    }
  };

  for (const [i, b] of (report.top ?? []).entries()) checkBlock(b, `top[${i}]`);

  // Two stats that print the same number on a period tab tell the reader one thing twice, like contributors and
  // newcomers on All time, when everyone is new.
  const kindOf = (f) => f.type ?? (f.options && f.options.length <= 5 ? "tabs" : "list");
  const valueOf = (o) => (o && typeof o === "object" ? o.value : o);
  const tabFilters = (report.filters ?? []).filter((f) => kindOf(f) === "tabs" && f.field);
  const settings = (report.filters ?? []).map((f) => [
    f,
    kindOf(f) === "tabs"
      ? (f.default ?? valueOf(f.options?.[0]))
      : kindOf(f) === "toggle"
        ? Boolean(f.default)
        : (f.default ?? null),
  ]);
  const statValue = (v, chosen) => {
    if (v == null || typeof v !== "object") return v;
    let rows = data[v.data] ?? [];
    for (const [f, value] of chosen) {
      if (kindOf(f) === "toggle") {
        if (!value) rows = rows.filter((r) => !r[f.field]);
      } else if (value != null && value !== "*")
        rows = rows.filter((r) => !(f.field in r) || r[f.field] === value);
    }
    if (v.where)
      rows = rows.filter((r) => Object.entries(v.where).every(([k, x]) => r[k] === x));
    if (v.agg === "count" && v.field == null) return rows.length;
    const xs = rows.map((r) => r[v.field]).filter((x) => typeof x === "number");
    if (!xs.length) return null;
    const agg = v.agg ?? "sum";
    if (agg === "count") return xs.length;
    if (agg === "mean") return xs.reduce((a, b) => a + b, 0) / xs.length;
    if (agg === "min") return Math.min(...xs);
    if (agg === "max") return Math.max(...xs);
    if (agg === "first") return xs[0];
    if (agg === "last") return xs.at(-1);
    return xs.reduce((a, b) => a + b, 0);
  };
  const tabCases = tabFilters.length
    ? tabFilters.flatMap((t) =>
        (t.options ?? []).map((o) => [
          `on "${o?.label ?? valueOf(o)}"`,
          settings.map(([f, v]) => [f, f === t ? valueOf(o) : v]),
        ]),
      )
    : [["", settings]];
  for (const [i, b] of (report.top ?? []).entries()) {
    if (b.type !== "stats") continue;
    for (const [where, chosen] of tabCases) {
      const seen = new Map();
      for (const s of b.items ?? []) {
        const v = statValue(s.value, chosen);
        if (typeof v !== "number" || v === 0) continue;
        if (seen.has(v))
          warn(
            `top[${i}]`,
            `"${seen.get(v)}" and "${s.label}" both show ${v.toLocaleString("en")}${where ? ` ${where}` : ""}, so one tells the reader nothing new there. Keep one, or show a number that differs on every tab.`,
          );
        else seen.set(v, s.label);
      }
    }
  }
  for (const [i, b] of (report.bottom ?? []).entries()) checkBlock(b, `bottom[${i}]`);
  if ((report.top ?? []).length > 2)
    err("report", "`top` holds at most 2 blocks (the numbers that stay on every tab).");
  if ((report.bottom ?? []).length > 1)
    err(
      "report",
      "`bottom` holds at most 1 block (the list of evidence rows that stays on every tab).",
    );

  const views = report.views ?? [];
  if (!views.length)
    err("report", "add `views`: the tabs of the report, each with `id`, `label` and `blocks`.");
  if (views.length > 7)
    err("report", `has ${views.length} views; keep at most 7 tabs and merge the rest.`);
  const ids = new Set();
  for (const [vi, view] of views.entries()) {
    const where = `views[${vi}] "${view.label ?? view.id}"`;
    keys(view, "view", where);
    if (!view.id || !/^[a-z0-9-]+$/.test(view.id))
      err(where, "give it an `id` in kebab-case, like `growth`.");
    if (ids.has(view.id)) err(where, `the id \`${view.id}\` is used twice.`);
    if (view.id === "method" && (report.method || report.intro))
      err(
        where,
        "the id `method` belongs to the Method tab that `method` and `intro` add; rename this view.",
      );
    ids.add(view.id);
    if (!view.label) err(where, "add a `label` for its tab.");
    text(view.label, LIMITS.label, where, "`label`");
    text(view.summary, LIMITS.summary, where, "`summary`", true);
    const blocks = view.blocks ?? [];
    if (!blocks.length) err(where, "add `blocks`.");
    if (blocks.length > 8)
      err(
        where,
        `has ${blocks.length} blocks; keep at most 8 per view, or split it into two views.`,
      );
    for (const [bi, b] of blocks.entries())
      checkBlock(b, `${where} > blocks[${bi}]${b.title ? ` "${b.title}"` : ""}`);
  }
  return { errors, warnings, escapes, rows: total, size };
}
