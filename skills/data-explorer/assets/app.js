const { parse, View } = vega;
const { compile } = vegaLite;

const PALETTE = [
  "#4d97de",
  "#e0894a",
  "#3ca694",
  "#d0505e",
  "#a37ecd",
  "#c9a227",
  "#c673a3",
  "#69a45c",
  "#8c6d4f",
  "#5c6bc0",
  "#90994e",
  "#8693a5",
];
const TONES = {
  good: "#3f9d5a",
  fair: "#a9c25a",
  warn: "#e0894a",
  bad: "#cf3f4e",
  muted: "#a3a3a3",
  accent: "#4d97de",
};
const report = JSON.parse(document.getElementById("report-data").textContent);
const data = report.data ?? {};
const views = [...report.views];
if (report.method || report.intro) views.push({ id: "method", label: "Method", method: true });
const filters = (report.filters ?? []).map((f) => ({ ...f, type: f.type ?? null }));

const state = { view: views[0].id, filters: {}, scale: {}, q: "" };
const charts = [];

// ---------- helpers

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat())
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
};

const escape = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const inline = (s = "") =>
  escape(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>',
    );
const markdown = (s = "") =>
  s
    .trim()
    .split(/\n{2,}/)
    .map((block) =>
      /^\s*[-*] /.test(block)
        ? `<ul>${block
            .split(/\n(?=\s*[-*] )/)
            .map((li) => `<li>${inline(li.replace(/^\s*[-*] /, ""))}</li>`)
            .join("")}</ul>`
        : /^#{1,3} /.test(block)
          ? `<h3>${inline(block.replace(/^#{1,3} /, ""))}</h3>`
          : `<p>${inline(block)}</p>`,
    )
    .join("");

const NUMBER = {
  number: (v) =>
    new Intl.NumberFormat("en", {
      maximumFractionDigits: Math.abs(v) < 10 ? 2 : Math.abs(v) < 100 ? 1 : 0,
    }).format(v),
  integer: (v) => new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(v),
  compact: (v) =>
    new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v),
  percent: (v) =>
    new Intl.NumberFormat("en", {
      style: "percent",
      maximumFractionDigits: Math.abs(v) < 0.1 && v !== 0 ? 1 : 0,
    }).format(v),
  money: (v) =>
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0,
    }).format(v),
};
const D3 = { number: ",.2~f", integer: ",.0f", compact: ".3~s", percent: ".0%", money: "$,.0f" };
const fmt = (v, kind = "number") => {
  if (v == null || v === "") return "–";
  if (typeof v !== "number") return String(v);
  return (NUMBER[kind] ?? NUMBER.number)(v);
};
// A number split into its figure and a short unit, so tiles print "53" big and "%" small.
const splitUnit = (text) => {
  const m = String(text).match(/^([^\d-]*)([-\d.,]+)(.*)$/);
  return m ? [m[1], m[2], m[3]] : ["", String(text), ""];
};
const DATE = /^\d{4}-\d{2}(-\d{2})?([T ][\d:.]+Z?)?$/;
const dateLabel = (s) => {
  const [y, m, d] = String(s).split(/[-T]/);
  const date = new Date(Date.UTC(+y, (+m || 1) - 1, +d || 1));
  const thisYear = String(new Date().getUTCFullYear()) === y;
  return date.toLocaleDateString("en", {
    year: d && thisYear ? undefined : "numeric",
    month: "short",
    ...(d ? { day: "numeric" } : {}),
    timeZone: "UTC",
  });
};
const flag = (cc) =>
  /^[A-Z]{2}$/.test(cc)
    ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0)))
    : "";
const regions = new Intl.DisplayNames(["en"], { type: "region" });
const country = (cc) => {
  try {
    return regions.of(cc);
  } catch {
    return cc;
  }
};
const tone = (name, i) =>
  TONES[name] ??
  (typeof name === "number"
    ? PALETTE[name % PALETTE.length]
    : name?.startsWith?.("#")
      ? name
      : PALETTE[i % PALETTE.length]);

// ---------- filters, colors and data

const valuesOf = (field) => {
  const seen = new Map();
  for (const rows of Object.values(data))
    for (const row of rows)
      if (field in row && row[field] != null && row[field] !== "")
        seen.set(row[field], (seen.get(row[field]) ?? 0) + 1);
  return [...seen.keys()];
};
const options = (f) =>
  f.options
    ? f.options.map((o) => (typeof o === "object" ? o : { value: o, label: String(o) }))
    : valuesOf(f.field).map((v) => ({ value: v, label: String(v) }));
const kindOf = (f) => f.type ?? (f.options && f.options.length <= 5 ? "tabs" : "list");

// Every value of a list filter keeps one color in every block, so a customer reads the same everywhere.
const COLORS = {};
for (const f of filters) {
  if (kindOf(f) !== "list" || f.colors === false) continue;
  const counts = countsFor(f, true);
  const order = options(f)
    .map((o) => o.value)
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  const given = typeof f.colors === "object" ? f.colors : {};
  COLORS[f.field] = new Map(
    order.map((v, i) => [
      v,
      given[v] != null ? tone(given[v], i) : i < PALETTE.length ? PALETTE[i] : TONES.muted,
    ]),
  );
}
const colorOf = (field, value) => COLORS[field]?.get(value);

function countsFor(f, ignoreFilters = false) {
  const name = f.count ?? Object.keys(data).find((n) => data[n].some((r) => f.field in r));
  const rows = ignoreFilters ? (data[name] ?? []) : rowsOf(name, f.field);
  const counts = new Map();
  for (const r of rows)
    counts.set(
      r[f.field],
      (counts.get(r[f.field]) ?? 0) + (f.countField ? (r[f.countField] ?? 0) : 1),
    );
  return counts;
}

function rowsOf(name, skip = []) {
  let rows = data[name] ?? [];
  for (const f of filters) {
    if ([skip].flat().includes(f.field)) continue;
    const value = state.filters[f.field];
    if (kindOf(f) === "toggle") {
      if (!value) rows = rows.filter((row) => !row[f.field]);
      continue;
    }
    if (value == null || value === "*") continue;
    rows = rows.filter((row) => !(f.field in row) || row[f.field] === value);
  }
  return rows;
}
const searched = (rows, fields) => {
  if (!state.q) return rows;
  const q = state.q.toLowerCase();
  return rows.filter((r) =>
    fields.some((f) =>
      String(r[f] ?? "")
        .toLowerCase()
        .includes(q),
    ),
  );
};

const AGG = {
  sum: (xs) => xs.reduce((a, b) => a + b, 0),
  count: (xs) => xs.length,
  mean: (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null),
  max: (xs) => (xs.length ? Math.max(...xs) : null),
  min: (xs) => (xs.length ? Math.min(...xs) : null),
  first: (xs) => xs[0],
  last: (xs) => xs.at(-1),
};
const resolve = (value) => {
  if (value == null || typeof value !== "object") return value;
  let rows = rowsOf(value.data);
  if (value.where)
    rows = rows.filter((row) => Object.entries(value.where).every(([k, v]) => row[k] === v));
  if (value.agg === "count" && value.field == null) return rows.length;
  const xs = rows.map((row) => row[value.field]).filter((v) => v != null);
  return (AGG[value.agg ?? "sum"] ?? AGG.sum)(xs);
};

// Sets every pair at once, as a matrix cell does both of its fields; when they're all set already, clears them.
const setFilters = (pairs) => {
  const on = pairs.every(([f, v]) => state.filters[f] === v);
  for (const [f, v] of pairs) state.filters[f] = on ? null : v;
  writeHash();
  void render();
};
const setFilter = (field, value) => setFilters([[field, value]]);
const clickable = (field) => filters.some((f) => f.field === field && kindOf(f) === "list");

// A block keeps every value of a list filter it draws, and fades the ones the filter leaves out, so a click on one bar
// or series doesn't redraw the chart around it. Every other block still narrows to the filter.
const shown = (...fields) => fields.filter((f) => f && clickable(f));
const selected = (field) => state.filters[field] != null && state.filters[field] !== "*";
const dimmed = (row, fields) =>
  fields.some((f) => selected(f) && row[f] != null && row[f] !== state.filters[f]);

// ---------- theme

const theme = () => document.documentElement.dataset.theme;
const vars = () => {
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  return {
    fg: v("--rp-fg"),
    muted: v("--rp-muted"),
    border: v("--rp-border"),
    grid: v("--rp-grid"),
    bg: v("--rp-bg"),
    soft: v("--rp-soft"),
  };
};

const config = (c) => ({
  background: null,
  font: getComputedStyle(document.body).fontFamily,
  padding: { left: 0, right: 4, top: 6, bottom: 0 },
  view: { stroke: null },
  axis: {
    labelColor: c.muted,
    titleColor: c.muted,
    labelFontSize: 11,
    titleFontSize: 11,
    titleFontWeight: 400,
    domainColor: c.border,
    tickColor: c.border,
    gridColor: c.grid,
    labelPadding: 6,
    titlePadding: 10,
  },
  axisX: { grid: false, tickSize: 4, labelOverlap: "greedy" },
  axisY: { domain: false, ticks: false, tickCount: 5, labelOverlap: true },
  axisBand: { tickBand: "extent" },
  legend: {
    labelColor: c.muted,
    titleColor: c.muted,
    labelFontSize: 11,
    orient: "top",
    direction: "horizontal",
    symbolType: "square",
    symbolSize: 70,
    title: null,
    offset: 10,
    padding: 0,
  },
  range: { category: PALETTE },
  text: { color: c.fg, fontSize: 11 },
  bar: { cornerRadiusEnd: 2, discreteBandSize: { band: 0.72 } },
  line: { strokeWidth: 2, strokeCap: "round", strokeJoin: "round" },
  point: { filled: true },
  title: { color: c.fg },
});

// ---------- charts

const field = (s) => String(s).replace(/[.[\]\\]/g, (m) => `\\${m}`);
const isDate = (rows, f) =>
  rows.some((r) => r[f] != null) &&
  rows.every((r) => r[f] == null || (typeof r[f] === "string" && DATE.test(r[f])));
const isNumber = (rows, f) => rows.every((r) => r[f] == null || typeof r[f] === "number");

const niceMax = (max) => {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= max) return m * p;
  return max;
};

const longRows = (block, rows) => {
  if (!Array.isArray(block.y)) return { rows, y: block.y, series: block.series };
  const labels = block.names ?? {};
  return {
    rows: rows.flatMap((r) =>
      block.y.map((k) => ({ ...r, __series: labels[k] ?? k, __value: r[k] })),
    ),
    y: "__value",
    series: "__series",
  };
};

// A series takes, in order: its tone from `tones`, the color its value keeps across the report, or the next palette color.
const seriesColor = (block, seriesField, keys) => {
  const c = vars();
  return keys.map((k, i) => {
    if (block.emphasis === k) return c.fg;
    if (block.highlight != null && k !== block.highlight) return c.muted;
    if (block.tones?.[i]) return tone(block.tones[i], i);
    const sourceField = seriesField === "__series" ? null : seriesField;
    return (sourceField && colorOf(sourceField, k)) ?? PALETTE[i % PALETTE.length];
  });
};

const xEncoding = (block, rows, x, kind, width) => {
  const title = block.xTitle ?? null;
  if (kind === "temporal")
    return {
      field: field(x),
      type: "temporal",
      title,
      scale: { type: "utc" },
      axis: {
        labelExpr: `utcFormat(datum.value, ${JSON.stringify(block.xFormat ?? (rows.some((r) => String(r[x]).length > 7) ? "%b %d" : "%b %Y"))})`,
        tickCount: 6,
      },
    };
  if (kind === "quantitative") {
    const years = rows.every(
      (r) => r[x] == null || (Number.isInteger(r[x]) && r[x] > 1900 && r[x] < 2200),
    );
    return {
      field: field(x),
      type: "quantitative",
      title,
      scale: {
        zero: false,
        nice: false,
        ...(state.scale[block.__id] === "log" || block.logX ? { type: "log" } : {}),
      },
      axis: years ? { format: "d", tickMinStep: 1 } : { format: D3.compact },
    };
  }
  const cats = [...new Set(rows.map((r) => r[x]))];
  const longest = Math.max(...cats.map((c) => String(c).length));
  const angle = longest * 6 > width / Math.max(cats.length, 1) - 8 ? -35 : 0;
  return {
    field: field(x),
    type: "ordinal",
    title,
    sort: null,
    axis: { labelLimit: 140, labelAngle: angle, labelAlign: angle ? "right" : "center" },
  };
};

function lineSpec(block, input, width) {
  const { rows, y, series } = longRows(block, input);
  const x = block.x;
  const kind =
    block.xType ?? (isDate(rows, x) ? "temporal" : isNumber(rows, x) ? "quantitative" : "ordinal");
  const height = block.height ?? 240;
  const format = D3[block.format] ?? D3.number;
  const log = state.scale[block.__id] === "log" || block.logY;
  const area = block.chart === "area";
  const stacked = area && series && block.stack !== false;
  const percent = Boolean(stacked) && block.stack === "percent";
  const values = rows.map((r) => r[y]).filter((v) => v != null);
  const keys = series ? [...new Set(rows.map((r) => r[series]))] : [];
  // Stacks put positives above zero and negatives below it, so each side sums apart.
  const sums = (sign) => {
    const by = new Map();
    for (const r of rows) if (sign * (r[y] ?? 0) > 0) by.set(r[x], (by.get(r[x]) ?? 0) + r[y]);
    return [...by.values()];
  };
  const top = Math.max(0, ...(stacked ? sums(1) : values));
  const bottom = Math.min(0, ...(stacked ? sums(-1) : values));
  const yMax = percent ? 1 : (block.yMax ?? niceMax(top));
  const yMin = percent || bottom === 0 ? 0 : -niceMax(-bottom);
  const range = series ? seriesColor(block, series, keys) : [];
  const color = series
    ? {
        field: field(series),
        type: "nominal",
        scale: { domain: keys, range },
        legend: stacked ? {} : null,
      }
    : { value: block.emphasis ? vars().fg : PALETTE[0] };
  const X = xEncoding(block, rows, x, kind, width);
  const Y = {
    field: field(y),
    type: "quantitative",
    title: block.yTitle ?? null,
    stack: stacked ? (percent ? "normalize" : "zero") : null,
    scale: log ? { type: "log" } : { domain: [yMin, yMax], nice: false },
    axis: {
      format:
        percent || block.format === "percent"
          ? ".0%"
          : (D3[block.format] ?? (top >= 10000 ? D3.compact : D3.number)),
    },
  };
  const strokeWidth =
    series && block.emphasis
      ? {
          condition: {
            test: `datum[${JSON.stringify(series)}] === ${JSON.stringify(block.emphasis)}`,
            value: 2.6,
          },
          value: 1.5,
        }
      : { value: 2 };
  const layers = [
    {
      mark: area
        ? {
            type: "area",
            line: { strokeWidth: 1.5 },
            opacity: stacked ? 0.85 : 0.18,
            interpolate: "monotone",
          }
        : {
            type: "line",
            interpolate: block.curve === false ? "linear" : "monotone",
            point: block.points ? { size: 22 } : false,
          },
      encoding: {
        x: X,
        y: Y,
        color,
        ...(series ? { detail: { field: field(series) } } : {}),
        ...(area ? {} : { strokeWidth }),
      },
    },
  ];
  if (series && !stacked && !log) {
    const last = new Map();
    for (const r of rows) if (r[y] != null) last.set(r[series], r);
    const ends = [...last.values()]
      .map((r) => ({
        name: r[series],
        x: r[x],
        y: r[y],
        py: height - ((r[y] - yMin) / (yMax - yMin)) * height,
      }))
      .sort((a, b) => a.py - b.py);
    for (let i = 1; i < ends.length; i++)
      if (ends[i].py - ends[i - 1].py < 12) ends[i].py = ends[i - 1].py + 12;
    const overflow = ends.length ? ends.at(-1).py - height : 0;
    if (overflow > 0) for (const e of ends) e.py -= overflow;
    layers.push({
      data: {
        values: ends.map((e) => ({
          [x]: e.x,
          __ly: yMin + ((height - e.py) / height) * (yMax - yMin),
          [series]: e.name,
          __label: block.endValues ? `${e.name} ${fmt(e.y, block.format ?? "number")}` : e.name,
        })),
      },
      mark: { type: "text", align: "left", baseline: "middle", dx: 7, fontWeight: 500 },
      encoding: {
        x: X,
        y: { field: "__ly", type: "quantitative", scale: Y.scale },
        text: { field: "__label" },
        color,
      },
    });
  }
  const tooltip = series
    ? [
        {
          field: field(x),
          type: X.type,
          title: block.xTitle ?? x,
          ...(kind === "temporal" ? { timeUnit: "utcyearmonthdate", format: "%b %d, %Y" } : {}),
        },
        ...keys.map((k, i) => ({
          field: percent ? `__share${i}` : field(k),
          type: "quantitative",
          title: k,
          format: percent || block.format === "percent" ? ".1%" : format,
        })),
      ]
    : [
        {
          field: field(x),
          type: X.type,
          title: block.xTitle ?? x,
          ...(kind === "temporal" ? { timeUnit: "utcyearmonthdate", format: "%b %d, %Y" } : {}),
        },
        { field: field(y), type: "quantitative", title: block.yTitle ?? y, format },
      ];
  layers.push({
    ...(series
      ? {
          transform: [
            { pivot: series, value: y, groupby: [x] },
            ...(percent
              ? [
                  {
                    calculate: keys.map((k) => `(datum[${JSON.stringify(k)}] || 0)`).join(" + "),
                    as: "__total",
                  },
                  ...keys.map((k, i) => ({
                    calculate: `datum.__total ? (datum[${JSON.stringify(k)}] || 0) / datum.__total : 0`,
                    as: `__share${i}`,
                  })),
                ]
              : []),
          ],
        }
      : {}),
    mark: { type: "rule", color: vars().muted, strokeWidth: 1 },
    encoding: {
      x: X,
      opacity: { condition: { param: "hover", empty: false, value: 0.6 }, value: 0 },
      tooltip,
    },
    params: [
      {
        name: "hover",
        select: {
          type: "point",
          fields: [x],
          nearest: true,
          on: "pointerover",
          clear: "pointerout",
        },
      },
    ],
  });
  if (!stacked)
    layers.push({
      mark: { type: "point", size: 36, filled: true },
      encoding: {
        x: X,
        y: Y,
        color,
        opacity: { condition: { param: "hover", empty: false, value: 1 }, value: 0 },
      },
    });
  return { data: { values: rows }, width, height, layer: layers };
}

function barSpec(block, input, width) {
  const { rows: all, y, series } = longRows(block, input);
  const x = block.x;
  const horizontal = block.horizontal ?? false;
  const stacked = block.chart === "stacked" || (series && block.chart !== "grouped");
  const percent = Boolean(stacked) && block.stack === "percent";
  const format = D3[block.format] ?? D3.number;
  let rows = all;
  const totals = new Map();
  for (const r of rows) totals.set(r[x], (totals.get(r[x]) ?? 0) + (r[y] ?? 0));
  if (block.limit) {
    const keep = new Set(
      [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, block.limit)
        .map(([k]) => k),
    );
    rows = rows.filter((r) => keep.has(r[x]));
  }
  const keys = series ? [...new Set(rows.map((r) => r[series]))] : [];
  const cats = [...new Set(rows.map((r) => r[x]))];
  const kind = block.xType ?? (isDate(rows, x) && !horizontal ? "temporal-ordinal" : "nominal");
  const sortByValue = block.sort === "value" || (horizontal && block.sort !== "data");
  const order = sortByValue
    ? [...cats].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))
    : null;
  const longest = Math.max(...cats.map((c) => String(c).length));
  const angle = !horizontal && longest * 6 > width / Math.max(cats.length, 1) - 6 ? -35 : 0;
  const category = {
    field: field(x),
    type: "ordinal",
    title: block.xTitle ?? null,
    sort: order,
    axis: {
      labelLimit: horizontal ? 160 : 110,
      labelAngle: angle,
      labelAlign: angle ? "right" : "center",
      ...(kind === "temporal-ordinal"
        ? { labelExpr: "datum.value == null ? '' : utcFormat(toDate(datum.value), '%b %y')" }
        : {}),
      ...(horizontal ? { ticks: false, domain: false } : {}),
    },
  };
  const side = (sign) => {
    if (!stacked) return rows.map((r) => r[y] ?? 0);
    const by = new Map();
    for (const r of rows) if (sign * (r[y] ?? 0) > 0) by.set(r[x], (by.get(r[x]) ?? 0) + r[y]);
    return [...by.values()];
  };
  const top = Math.max(0, ...side(1));
  const bottom = Math.min(0, ...side(-1));
  const labels = block.labels !== false && cats.length <= (horizontal ? 40 : 18);
  const value = {
    field: field(y),
    type: "quantitative",
    title: block.yTitle ?? null,
    stack: stacked ? (percent ? "normalize" : "zero") : null,
    scale: percent
      ? { domain: [0, 1] }
      : {
          domain: [
            bottom < 0 ? -niceMax(-bottom * 1.06) : 0,
            niceMax(top * (labels && horizontal ? 1.12 : 1.06)),
          ],
          nice: false,
        },
    axis: horizontal
      ? null
      : { format: percent ? ".0%" : (D3[block.format] ?? (top >= 10000 ? D3.compact : D3.number)) },
  };
  const c = vars();
  const color = series
    ? {
        field: field(series),
        type: "nominal",
        scale: { domain: keys, range: seriesColor(block, series, keys) },
        legend: {},
      }
    : COLORS[x]
      ? {
          field: field(x),
          type: "nominal",
          scale: { domain: cats, range: cats.map((k) => colorOf(x, k) ?? c.muted) },
          legend: null,
        }
      : block.highlight != null
        ? {
            condition: {
              test: `datum[${JSON.stringify(x)}] === ${JSON.stringify(block.highlight)}`,
              value: PALETTE[0],
            },
            value: c.grid,
          }
        : { value: block.tones?.[0] ? tone(block.tones[0], 0) : PALETTE[0] };
  const tooltip = [
    { field: field(x), type: "ordinal", title: block.xTitle ?? x },
    ...(series
      ? [
          {
            field: field(series),
            type: "nominal",
            title: series === "__series" ? "Series" : series,
          },
        ]
      : []),
    {
      field: field(y),
      type: "quantitative",
      title: block.yTitle ?? (y === "__value" ? "Value" : y),
      format,
    },
  ];
  const enc = horizontal ? { y: category, x: value } : { x: category, y: value };
  if (series && block.chart === "grouped")
    enc[horizontal ? "yOffset" : "xOffset"] = { field: field(series), sort: keys };
  const layers = [
    {
      mark: {
        type: "bar",
        ...(stacked && series ? { cornerRadiusEnd: 0, stroke: c.bg, strokeWidth: 1 } : {}),
      },
      encoding: { ...enc, color, tooltip },
    },
  ];
  if (labels && !percent) {
    const text = {
      type: "text",
      fontSize: 10.5,
      color: c.muted,
      ...(horizontal
        ? { align: "left", dx: 4, baseline: "middle" }
        : { baseline: "bottom", dy: -3 }),
    };
    const shown = {
      field: "__total",
      type: "quantitative",
      format: D3[block.format] ?? (top >= 10000 ? D3.compact : D3.number),
    };
    if (stacked && series)
      layers.push({
        transform: [{ aggregate: [{ op: "sum", field: y, as: "__total" }], groupby: [x] }],
        mark: text,
        encoding: {
          ...(horizontal
            ? { y: category, x: { ...value, field: "__total", stack: null } }
            : { x: category, y: { ...value, field: "__total", stack: null } }),
          text: shown,
        },
      });
    else if (!series)
      layers.push({
        transform: [{ calculate: `datum[${JSON.stringify(y)}]`, as: "__total" }],
        mark: text,
        encoding: { ...enc, text: shown },
      });
  }
  const step = horizontal
    ? series && block.chart === "grouped"
      ? 10 * keys.length + 8
      : 22
    : null;
  return {
    data: { values: rows },
    width,
    height: horizontal ? { step } : (block.height ?? 240),
    layer: layers,
  };
}

function scatterSpec(block, rows, width) {
  const logX = state.scale[block.__id] === "log" || block.logX;
  const logY = block.logY;
  const format = D3[block.format] ?? D3.number;
  const keys = block.series ? [...new Set(rows.map((r) => r[block.series]))] : [];
  const color = block.series
    ? {
        field: field(block.series),
        type: "nominal",
        scale: { domain: keys, range: seriesColor(block, block.series, keys) },
        legend: {},
      }
    : { value: PALETTE[0] };
  // A log scale can't place 0, so a field with zeros gets symlog, which keeps them on the axis.
  const pos = (f, log, title) => {
    const zeros = log && rows.some((r) => r[f] != null && r[f] <= 0);
    const max = Math.max(...rows.map((r) => r[f] ?? 0));
    const decades = [0, ...Array.from({ length: 12 }, (_, i) => 10 ** i).filter((v) => v <= max)];
    return {
      field: field(f),
      type: "quantitative",
      title: title ?? f,
      scale: { zero: false, ...(log ? { type: zeros ? "symlog" : "log" } : { nice: true }) },
      axis: { format: D3.compact, ...(zeros ? { values: decades } : {}) },
    };
  };
  const enc = { x: pos(block.x, logX, block.xTitle), y: pos(block.y, logY, block.yTitle), color };
  const tooltip = [
    ...(block.label ? [{ field: field(block.label), type: "nominal", title: block.label }] : []),
    ...(block.series ? [{ field: field(block.series), type: "nominal" }] : []),
    { field: field(block.x), type: "quantitative", title: block.xTitle ?? block.x, format },
    { field: field(block.y), type: "quantitative", title: block.yTitle ?? block.y, format },
    ...(block.size ? [{ field: field(block.size), type: "quantitative", format }] : []),
  ];
  const layers = [
    {
      mark: {
        type: "circle",
        opacity: 0.75,
        stroke: vars().bg,
        strokeWidth: 0.5,
        ...(scatterClick(block) ? { cursor: "pointer" } : {}),
      },
      encoding: {
        ...enc,
        size: block.size
          ? {
              field: field(block.size),
              type: "quantitative",
              legend: null,
              scale: { range: [16, 600] },
            }
          : { value: 36 },
        tooltip,
      },
    },
  ];
  // Labels go in pixels once the chart has drawn, so placeLabels can move them apart.
  if (block.label)
    for (const side of ["left", "right"])
      layers.push({
        data: { name: `labels_${side}` },
        mark: { type: "text", align: side, baseline: "middle", fontSize: 10.5 },
        encoding: {
          x: { field: "px", type: "quantitative", scale: null, axis: null },
          y: { field: "py", type: "quantitative", scale: null, axis: null },
          text: { field: "text" },
          color: { value: vars().muted },
        },
      });
  return {
    data: { values: rows },
    datasets: { labels_left: [], labels_right: [] },
    width,
    height: block.height ?? 300,
    layer: layers,
  };
}

// What a click on a point does: filter by the label or series when it's a list filter, else search for the label,
// which narrows every table to that row.
function scatterClick(block) {
  const target = [block.label, block.series].find((f) => f && clickable(f));
  if (target) return (d) => setFilter(target, d[target]);
  if (!block.label || !report.search) return null;
  return (d) => {
    const q = String(d[block.label]);
    state.q = state.q === q ? "" : q;
    writeHash();
    void render();
  };
}

// The list filters a click on a bar, line or area chart sets: its series, and its category.
function chartTargets(block) {
  if (block.type === "vega" || block.chart === "scatter" || block.chart === "histogram") return null;
  const series = clickable(block.series) ? block.series : null;
  const x = clickable(block.x) ? block.x : null;
  return series || x ? { series, x } : null;
}

// The list filters a chart draws whole and fades: a scatter's label and series, any other chart's series and category.
function chartFields(block) {
  if (block.type === "vega" || block.chart === "histogram") return [];
  return block.chart === "scatter" ? shown(block.label, block.series) : shown(block.series, block.x);
}

const FADE = 0.2;
// Multiplies a mark's opacity, whatever Vega-Lite set it to, by FADE where `test` holds. Axis labels fade their fill:
// Vega sets their opacity itself, to hide labels that overlap.
const fade = (encode = {}, part, test, key = "opacity") => {
  const target = part ? (encode[part] ??= {}) : encode;
  const update = (target.update ??= {});
  const mult = { signal: `(${test}) ? ${FADE} : 1` };
  const scale = (ref) => ({ ...ref, mult: ref.mult == null ? mult : { ...mult, mult: ref.mult } });
  const base = update[key] ?? target.enter?.[key] ?? { value: 1 };
  update[key] = Array.isArray(base) ? base.map(scale) : scale(base);
  return encode;
};

function fadeSpec(spec, block, fields) {
  const on = fields.filter(selected);
  if (!on.length) return;
  const value = (f) => JSON.stringify(state.filters[f]);
  const rows = on
    .map((f) => `(datum[${JSON.stringify(f)}] != null && datum[${JSON.stringify(f)}] !== ${value(f)})`)
    .join(" || ");
  const marks = (list = []) => {
    for (const m of list) {
      if (m.type === "group") marks(m.marks);
      else if (!m.name?.endsWith("_voronoi")) m.encode = fade(m.encode, null, rows);
    }
  };
  marks(spec.marks);
  const axis = block.horizontal ? "y" : "x";
  if (on.includes(block.x))
    for (const a of spec.axes ?? [])
      if (a.scale === axis) a.encode = fade(a.encode, "labels", `datum.value !== ${value(block.x)}`, "fillOpacity");
  if (on.includes(block.series))
    for (const l of spec.legends ?? []) {
      const test = `datum.value !== ${value(block.series)}`;
      l.encode = fade(fade(l.encode, "symbols", test), "labels", test);
    }
}

// Vega leaves axes and legends out of picking, so the compiled spec turns on the category's labels and the series'
// legend, and every mark takes clicks and shows a pointer.
function clickableSpec(spec, block, { series, x }) {
  const pointer = (encode = {}, part) => ({
    ...encode,
    [part]: {
      ...encode[part],
      interactive: true,
      update: { ...encode[part]?.update, cursor: { value: "pointer" } },
    },
  });
  const axis = block.horizontal ? "y" : "x";
  if (x) for (const a of spec.axes ?? []) if (a.scale === axis) a.encode = pointer(a.encode, "labels");
  if (series)
    for (const l of spec.legends ?? []) l.encode = pointer(pointer(l.encode, "symbols"), "labels");
  const marks = (list = []) => {
    for (const m of list) {
      if (m.type === "group") marks(m.marks);
      else {
        // Vega-Lite turns picking off for marks without a tooltip, such as a line's name at its end.
        m.interactive = true;
        m.encode = { ...m.encode, update: { ...m.encode?.update, cursor: { value: "pointer" } } };
      }
    }
  };
  marks(spec.marks);
}

// What a click on a chart does. A bar, line, area or legend entry filters by its series when that's a list filter's
// field, and otherwise by its category, as does the category's axis label. Scatter points have their own rule.
function chartClick(block, spec, view, host) {
  if (block.chart === "scatter") {
    const click = scatterClick(block);
    return click
      ? (_, item) => {
          if (item?.mark?.marktype === "symbol" && item.datum) click(item.datum);
        }
      : null;
  }
  const targets = chartTargets(block);
  if (!targets) return null;
  const { series, x } = targets;
  return (event, item) => {
    const role = item?.mark?.role;
    if (role === "legend-symbol" || role === "legend-label") {
      if (series) setFilter(series, item.datum.value);
      return;
    }
    if (role === "axis-label") {
      if (x) setFilter(x, item.datum.value);
      return;
    }
    // A line chart's hover layer covers the plot, and its datum is the row of the x under the pointer, so the series
    // comes from where the pointer is.
    const d = item?.datum?.datum ?? item?.datum;
    if (!d) return;
    const hover = item.mark.name?.endsWith("_voronoi");
    const hit = !series
      ? null
      : hover
        ? seriesAt(spec, view, host, event, block, d[block.x])
        : d[series];
    if (hit != null) setFilter(series, hit);
    else if (x && d[x] != null) setFilter(x, d[x]);
  };
}

// The series drawn nearest the pointer at x: the band it falls in on a stacked chart, else the closest line. It reads
// the rows Vega drew, which carry the stack's bounds and the same parsed x as the hover layer.
function seriesAt(spec, view, host, event, block, at) {
  const svg = host.querySelector("svg");
  if (!svg || at == null) return null;
  const key = (v) => (v instanceof Date ? +v : v);
  const v = view.scale("y").invert(event.clientY - svg.getBoundingClientRect().top - view.origin()[1]);
  const { series, y } = block;
  let best = null;
  let gap = Infinity;
  for (const { name } of spec.data ?? []) {
    for (const t of view.data(name) ?? []) {
      if (t[series] == null || key(t[block.x]) !== key(at)) continue;
      const lo = t[`${y}_start`];
      const hi = t[`${y}_end`];
      if (lo != null && hi != null) {
        if (v >= Math.min(lo, hi) && v <= Math.max(lo, hi)) return t[series];
      } else if (typeof t[y] === "number" && Math.abs(t[y] - v) < gap) {
        gap = Math.abs(t[y] - v);
        best = t[series];
      }
    }
  }
  return best;
}

// Names the top points, largest first, each just past its circle at the first spot 12 px up or down that clears the
// names already placed. A name that would run past the right edge goes on the point's left.
async function placeLabels(view, block, rows) {
  const xs = view.scale("x");
  const ys = view.scale("y");
  const sizes = block.size ? view.scale("size") : null;
  const width = view.width();
  const height = view.height();
  const key = block.size ?? block.y;
  const n = block.labelTop ?? (rows.length <= 12 ? rows.length : 6);
  const top = rows
    .filter((r) => r[block.x] != null && r[block.y] != null)
    .toSorted((a, b) => (b[key] ?? 0) - (a[key] ?? 0))
    .slice(0, n);
  const placed = [];
  for (const r of top) {
    const text = String(r[block.label]);
    const w = text.length * 6 + 2;
    const px = xs(r[block.x]);
    const py = ys(r[block.y]);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const gap = Math.sqrt((sizes ? sizes(r[block.size]) : 36) / Math.PI) + 4;
    const side = px + gap + w > width ? "right" : "left";
    const x0 = side === "right" ? px - gap - w : px + gap;
    const free = (y) =>
      y >= 6 &&
      y <= height - 6 &&
      placed.every((p) => x0 >= p.x0 + p.w || p.x0 >= x0 + w || Math.abs(y - p.py) >= 12);
    const y = [0, -12, 12, -24, 24, -36, 36].map((d) => py + d).find(free);
    if (y == null) continue;
    placed.push({ x0, w, side, px: side === "right" ? px - gap : px + gap, py: y, text });
  }
  const of = (side) =>
    placed.filter((p) => p.side === side).map(({ px, py, text }) => ({ px, py, text }));
  await view.data("labels_left", of("left")).data("labels_right", of("right")).runAsync();
}

function histogramSpec(block, rows, width) {
  const log = state.scale[block.__id] === "log" || block.logX;
  const source = log
    ? rows.filter((r) => r[block.x] > 0).map((r) => ({ ...r, __log: Math.log10(r[block.x]) }))
    : rows;
  const f = log ? "__log" : block.x;
  return {
    data: { values: source },
    width,
    height: block.height ?? 200,
    mark: { type: "bar", color: PALETTE[0], cornerRadiusEnd: 1, binSpacing: 1 },
    encoding: {
      x: {
        bin: { maxbins: block.bins ?? 30 },
        field: f,
        type: "quantitative",
        title: block.xTitle ?? block.x,
        axis: log ? { labelExpr: "format(pow(10, datum.value), '.2~s')" } : { format: D3.compact },
      },
      y: { aggregate: "count", type: "quantitative", title: null, axis: { format: D3.compact } },
      tooltip: [{ aggregate: "count", type: "quantitative", title: "Count" }],
    },
  };
}

const SPECS = {
  line: lineSpec,
  area: lineSpec,
  bar: barSpec,
  stacked: barSpec,
  grouped: barSpec,
  scatter: scatterSpec,
  histogram: histogramSpec,
};

function vegaSpec(block, width) {
  const spec = structuredClone(block.spec);
  const named = spec.data?.name;
  if (named) spec.data = { values: rowsOf(named) };
  return { ...spec, width: spec.width ?? width, height: spec.height ?? block.height ?? 240 };
}

const tooltip = document.createElement("div");
tooltip.className = "rp-tip";
tooltip.hidden = true;
document.body.append(tooltip);
function showTip(event, title, rows) {
  tooltip.innerHTML = `<b>${escape(title)}</b>${rows.map(([k, v]) => `<div><span>${escape(k)}</span><span>${escape(v)}</span></div>`).join("")}`;
  tooltip.hidden = false;
  const box = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.min(event.clientX + 14, innerWidth - box.width - 8)}px`;
  tooltip.style.top = `${Math.min(event.clientY + 14, innerHeight - box.height - 8)}px`;
}
const hideTip = () => (tooltip.hidden = true);
function tip(handler, event, item, value) {
  if (value == null || value === "" || !event) return hideTip();
  const rows = typeof value === "object" ? Object.entries(value) : [["", value]];
  const [[, v0], ...rest] = rows;
  showTip(event, v0, rest);
}

async function drawChart(entry) {
  const { block, el } = entry;
  const width = Math.max(240, Math.floor(el.clientWidth));
  try {
    const fields = chartFields(block);
    const rows = block.type === "vega" ? null : rowsOf(block.data, fields);
    if (rows && !rows.length) {
      el.replaceChildren(h("p", { class: "rp-empty" }, "No rows for this filter."));
      el.dataset.state = "ok";
      return;
    }
    const lite =
      block.type === "vega" ? vegaSpec(block, width) : SPECS[block.chart](block, rows, width);
    lite.$schema = "https://vega.github.io/schema/vega-lite/v6.json";
    lite.autosize = { type: "fit-x", contains: "padding" };
    lite.config = { ...config(vars()), ...lite.config };
    const compiled = compile(lite).spec;
    const targets = chartTargets(block);
    if (targets) clickableSpec(compiled, block, targets);
    fadeSpec(compiled, block, fields);
    entry.view?.finalize();
    const host = h("div", { class: "rp-chart-svg" });
    el.replaceChildren(host);
    entry.view = new View(parse(compiled), {
      renderer: "svg",
      container: host,
      hover: true,
      tooltip: tip,
    });
    await entry.view.runAsync();
    if (block.chart === "scatter" && block.label) await placeLabels(entry.view, block, rows);
    const click = chartClick(block, compiled, entry.view, host);
    if (click) entry.view.addEventListener("click", click);
    el.dataset.state = "ok";
  } catch (error) {
    el.dataset.state = "error";
    el.dataset.error = String(error.message ?? error);
    el.replaceChildren(
      h("p", { class: "rp-empty" }, `This chart failed to draw: ${error.message ?? error}`),
    );
  }
}

// ---------- blocks

const dot = (color) => (color ? h("i", { class: "rp-dot", style: { background: color } }) : null);
const entity = (fieldName, value) =>
  h("span", { class: "rp-entity" }, dot(colorOf(fieldName, value)), value ?? "–");

function statsBlock(block) {
  return h(
    "div",
    { class: "rp-stats" },
    block.items.map((item) => {
      const value = resolve(item.value);
      const delta = resolve(item.delta);
      const [pre, num, unit] = splitUnit(fmt(value, item.format ?? "number"));
      const deltaText =
        delta == null
          ? null
          : `${delta > 0 ? "+" : ""}${fmt(delta, item.deltaFormat ?? "percent")}`;
      const good = item.good === "down" ? delta < 0 : delta > 0;
      return h(
        "div",
        { class: "rp-stat" },
        h(
          "div",
          { class: "rp-stat-value" },
          pre && h("small", {}, pre),
          num,
          unit && h("small", {}, unit),
          item.unit && h("small", {}, ` ${item.unit}`),
        ),
        h("div", { class: "rp-stat-label" }, item.label),
        (deltaText || item.hint) &&
          h(
            "div",
            { class: "rp-stat-foot" },
            deltaText &&
              h(
                "span",
                { class: `rp-delta ${delta === 0 ? "" : good ? "is-up" : "is-down"}` },
                deltaText,
              ),
            item.hint && h("span", {}, item.hint),
          ),
      );
    }),
  );
}

function factsBlock(block) {
  return h(
    "div",
    { class: "rp-facts" },
    block.items.map((item) => {
      const [pre, num, unit] = splitUnit(
        typeof item.value === "string"
          ? item.value
          : fmt(resolve(item.value), item.format ?? "number"),
      );
      return h(
        "div",
        { class: "rp-fact" },
        h("div", { class: "rp-fact-value" }, pre, num, unit && h("small", {}, unit)),
        h("p", { html: inline(item.text) }),
      );
    }),
  );
}

function legend(names, colors) {
  return h(
    "div",
    { class: "rp-legend" },
    names.map((n, i) => h("span", {}, h("i", { style: { background: colors[i] } }), n)),
  );
}

// Rows of horizontal bars drawn in HTML: a label, the bar (one value or segments), and a short note after it.
function barsBlock(block) {
  const fields = shown(block.label);
  let rows = rowsOf(block.data, fields);
  const segments = block.segments ?? [block.value];
  const names = segments.map((s) => block.names?.[s] ?? s);
  const colors = segments.map((s, i) =>
    block.tones?.[i]
      ? tone(block.tones[i], i)
      : segments.length === 1
        ? null
        : PALETTE[i % PALETTE.length],
  );
  const total = (r) => segments.reduce((a, s) => a + (r[s] ?? 0), 0);
  if (block.sort !== "data") rows = [...rows].sort((a, b) => total(b) - total(a));
  if (block.limit) rows = rows.slice(0, block.limit);
  const max = block.percent ? 1 : Math.max(...rows.map(total), 0) || 1;
  const labelColor = (r) => colorOf(block.label, r[block.label]);
  const list = h(
    "div",
    { class: "rp-bars" },
    rows.map((r) => {
      const single =
        segments.length === 1
          ? (labelColor(r) ?? (block.tones?.[0] ? tone(block.tones[0], 0) : PALETTE[0]))
          : null;
      const sum = total(r);
      const scale = block.percent && sum ? 1 / sum : 1;
      const end = block.end
        ? typeof r[block.end] === "number"
          ? fmt(r[block.end], block.format)
          : r[block.end]
        : fmt(sum, block.format);
      const go = clickable(block.label) ? () => setFilter(block.label, r[block.label]) : null;
      return h(
        "div",
        {
          class: `rp-bars-row${go ? " is-click" : ""}${state.filters[block.label] === r[block.label] ? " is-on" : ""}${dimmed(r, fields) ? " is-dim" : ""}`,
          onclick: go,
          onmousemove: (e) =>
            showTip(
              e,
              r[block.label],
              segments.map((s, i) => [names[i], fmt(r[s], block.format)]),
            ),
          onmouseleave: hideTip,
        },
        h("span", { class: "rp-bars-label" }, dot(labelColor(r)), h("span", {}, r[block.label])),
        h(
          "span",
          { class: "rp-bars-track" },
          h(
            "span",
            {
              class: "rp-bars-fill",
              style: { width: `calc((100% - 92px) * ${(sum * scale) / max})` },
            },
            segments.map((s, i) =>
              h("span", {
                style: {
                  width: `${sum ? ((r[s] ?? 0) / sum) * 100 : 0}%`,
                  background: single ?? colors[i],
                },
              }),
            ),
          ),
          h("span", { class: "rp-bars-end" }, end),
        ),
      );
    }),
  );
  return h("div", {}, segments.length > 1 ? legend(names, colors) : null, list);
}

// A matrix in HTML: rows and columns keep the data's order, cells tint by their share of the largest value.
function matrixBlock(block) {
  const fields = shown(block.x, block.y);
  const rows = rowsOf(block.data, fields);
  const dim = (pairs) => (dimmed(Object.fromEntries(pairs), fields) ? "is-dim" : null);
  const xs = block.columns ?? [...new Set(rows.map((r) => r[block.x]))];
  const ys = [...new Set(rows.map((r) => r[block.y]))];
  const cell = new Map(rows.map((r) => [`${r[block.y]}\u0000${r[block.x]}`, r[block.value]]));
  const values = [...cell.values()].filter((v) => typeof v === "number");
  const max = Math.max(...values, 0) || 1;
  const rowMax = new Map(
    ys.map((y) => [y, Math.max(...xs.map((x) => cell.get(`${y}\u0000${x}`) ?? 0), 0) || 1]),
  );
  const tint = (x, i) =>
    block.tint === "columns"
      ? (colorOf(block.x, x) ?? PALETTE[i % PALETTE.length])
      : block.tint === "rows"
        ? null
        : block.tones?.[0]
          ? tone(block.tones[0], 0)
          : PALETTE[0];
  const longest = Math.max(...xs.map((x) => String(x).length));
  const rotate = longest > 14 || (xs.length > 8 && longest > 5);
  return h(
    "div",
    { class: "rp-scroll" },
    h(
      "table",
      { class: `rp-matrix${rotate ? " is-rotated" : ""}` },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", {}),
          xs.map((x) =>
            h(
              "th",
              clickable(block.x)
                ? {
                    class: ["is-click", dim([[block.x, x]])].filter(Boolean).join(" "),
                    onclick: () => setFilter(block.x, x),
                  }
                : {},
              h("span", {}, x),
            ),
          ),
        ),
      ),
      h(
        "tbody",
        {},
        ys.map((y) =>
          h(
            "tr",
            {},
            h(
              "th",
              {
                class: clickable(block.y)
                  ? ["is-click", dim([[block.y, y]])].filter(Boolean).join(" ")
                  : null,
                onclick: clickable(block.y) ? () => setFilter(block.y, y) : null,
              },
              entity(block.y, y),
            ),
            xs.map((x, i) => {
              const v = cell.get(`${y}\u0000${x}`);
              const pairs = [
                [block.y, y],
                [block.x, x],
              ].filter(([f]) => clickable(f));
              const base = block.tint === "rows" ? (colorOf(block.y, y) ?? PALETTE[0]) : tint(x, i);
              const t =
                typeof v === "number" && v > 0
                  ? v / (block.scale === "row" ? rowMax.get(y) : max)
                  : 0;
              return h(
                "td",
                {
                  style: t
                    ? {
                        background: `color-mix(in oklab, ${base} ${Math.round(12 + t * 58)}%, var(--rp-bg))`,
                        color: t > 0.82 ? "#fff" : null,
                      }
                    : null,
                  class:
                    [pairs.length && v != null ? "is-click" : null, dim(pairs)]
                      .filter(Boolean)
                      .join(" ") || null,
                  onclick: pairs.length && v != null ? () => setFilters(pairs) : null,
                  onmousemove: v != null ? (e) => showTip(e, y, [[x, fmt(v, block.format)]]) : null,
                  onmouseleave: hideTip,
                },
                typeof v === "number" && v !== 0 ? fmt(v, block.format) : "",
              );
            }),
          ),
        ),
      ),
    ),
  );
}

function stackCell(row, col) {
  const parts = col.fields.map((f, i) => ({
    name: col.names?.[f] ?? f,
    v: row[f] ?? 0,
    color: col.tones?.[i]
      ? tone(col.tones[i], i)
      : (colorOf(col.colorBy, f) ?? PALETTE[i % PALETTE.length]),
  }));
  const sum = parts.reduce((a, p) => a + p.v, 0);
  return h(
    "td",
    {
      class: "rp-stack-cell",
      onmousemove: (e) =>
        showTip(
          e,
          col.label ?? "Mix",
          parts.filter((p) => p.v).map((p) => [p.name, fmt(p.v, col.number)]),
        ),
      onmouseleave: hideTip,
    },
    h(
      "span",
      { class: "rp-stack" },
      sum
        ? parts.map((p) =>
            h("span", { style: { width: `${(p.v / sum) * 100}%`, background: p.color } }),
          )
        : null,
    ),
  );
}

function cell(row, col, max, min) {
  const v = row[col.field];
  const kind = col.format ?? (typeof v === "number" ? "number" : "text");
  if (kind === "stack") return stackCell(row, col);
  if (kind === "entity") return h("td", {}, entity(col.field, v));
  if (kind === "user") {
    const name = String(v ?? "");
    return h(
      "td",
      { class: "rp-user" },
      h(
        "a",
        { href: `https://github.com/${name}`, target: "_blank", rel: "noopener" },
        h("img", { src: `https://github.com/${name}.png?size=40`, alt: "", width: 18, height: 18 }),
        name,
      ),
    );
  }
  if (kind === "country") return h("td", {}, v ? `${flag(v)} ${country(v)}` : "–");
  if (kind === "link")
    return h(
      "td",
      {},
      v
        ? h(
            "a",
            { href: v, target: "_blank", rel: "noopener" },
            String(v).replace(/^https?:\/\/(www\.)?/, ""),
          )
        : "–",
    );
  if (kind === "date") return h("td", { class: "rp-num rp-muted" }, v ? dateLabel(v) : "–");
  if (kind === "chips") {
    const items = Array.isArray(v) ? v : [];
    return h(
      "td",
      {},
      items.length
        ? h(
            "span",
            { class: "rp-chips" },
            items.map((c) =>
              h(
                "span",
                { class: "rp-chip" },
                Array.isArray(c) ? [c[0], h("b", {}, ` ${c[1]}`)] : c,
              ),
            ),
          )
        : h("span", { class: "rp-muted" }, "none"),
    );
  }
  if (kind === "text")
    return h(
      "td",
      { class: col.truncate ? "rp-trunc" : null, title: col.truncate ? v : null },
      v ?? "–",
    );
  if (kind === "bar") {
    const w = max > 0 && typeof v === "number" ? Math.max(0, (v / max) * 100) : 0;
    // The flex row goes inside the cell: a <td> with display: flex stops being a table cell, keeps its own height, and
    // its number and divider sit higher than the rest of the row.
    return h(
      "td",
      { class: "rp-num rp-barcell" },
      h(
        "span",
        { class: "rp-barline" },
        h("span", { class: "rp-inbar" }, h("span", { style: { width: `${w}%` } })),
        h("span", {}, fmt(v, col.number ?? "number")),
      ),
    );
  }
  if (kind === "heat") {
    const t = typeof v === "number" && max > min ? (v - min) / (max - min) : 0;
    return h(
      "td",
      { class: "rp-num rp-heat", style: { "--t": t.toFixed(3) } },
      fmt(v, col.number ?? "number"),
    );
  }
  if (kind === "delta")
    return h(
      "td",
      { class: `rp-num rp-delta ${v > 0 ? "is-up" : v < 0 ? "is-down" : ""}` },
      v == null ? "–" : `${v > 0 ? "+" : ""}${fmt(v, col.number ?? "percent")}`,
    );
  return h(
    "td",
    { class: "rp-num" },
    fmt(v, kind),
    col.suffix ? h("span", { class: "rp-muted" }, ` ${row[col.suffix] ?? ""}`) : null,
  );
}

const local = new Map();
function tableBlock(block) {
  const wrap = h("div", { class: `rp-table${block.style === "rows" ? " is-rows" : ""}` });
  const own = local.get(block.__id) ?? {
    sort: block.sort ?? null,
    desc: true,
    query: "",
    shown: block.limit ?? 12,
  };
  local.set(block.__id, own);
  const draw = () => {
    let rows = rowsOf(block.data);
    const textFields = block.columns
      .filter((c) => !["stack", "bar", "heat"].includes(c.format))
      .map((c) => c.field);
    rows = searched(rows, textFields);
    if (own.query) {
      const q = own.query.toLowerCase();
      rows = rows.filter((r) =>
        textFields.some((f) =>
          String(r[f] ?? "")
            .toLowerCase()
            .includes(q),
        ),
      );
    }
    if (own.sort)
      rows = [...rows].sort((a, b) =>
        a[own.sort] == null
          ? b[own.sort] == null
            ? 0
            : 1
          : b[own.sort] == null
            ? -1
            : (a[own.sort] > b[own.sort] ? 1 : a[own.sort] < b[own.sort] ? -1 : 0) *
              (own.desc ? -1 : 1),
      );
    const stats = Object.fromEntries(
      block.columns
        .map((c) => [c.field, rows.map((r) => r[c.field]).filter((v) => typeof v === "number")])
        .map(([k, xs]) => [k, [Math.max(...xs), Math.min(...xs)]]),
    );
    const shown = rows.slice(0, own.shown);
    const clickField = block.columns.find((c) => clickable(c.field))?.field;
    const rank = block.rank ?? block.style !== "rows";
    const table = h(
      "table",
      {},
      block.header === false || block.style === "rows"
        ? null
        : h(
            "thead",
            {},
            h(
              "tr",
              {},
              rank && h("th", { class: "rp-rank" }, "#"),
              block.columns.map((c) =>
                h(
                  "th",
                  {
                    class:
                      ["user", "text", "country", "link", "entity", "chips", "stack"].includes(
                        c.format ?? "text",
                      ) && c.format !== undefined
                        ? ""
                        : "rp-num",
                    "aria-sort":
                      own.sort === c.field ? (own.desc ? "descending" : "ascending") : null,
                  },
                  c.format === "stack" || c.format === "chips"
                    ? (c.label ?? c.field)
                    : h(
                        "button",
                        {
                          onclick: () => (
                            (own.desc = own.sort === c.field ? !own.desc : true),
                            (own.sort = c.field),
                            draw()
                          ),
                        },
                        c.label ?? c.field,
                        own.sort === c.field ? (own.desc ? " ↓" : " ↑") : "",
                      ),
                ),
              ),
            ),
          ),
      h(
        "tbody",
        {},
        shown.map((row, i) =>
          h(
            "tr",
            {
              class: clickField
                ? `is-click${state.filters[clickField] === row[clickField] ? " is-on" : ""}`
                : null,
              onclick: clickField
                ? (e) => {
                    const own = e.target.closest("td")?.dataset.field;
                    const f = own && clickable(own) ? own : clickField;
                    setFilter(f, row[f]);
                  }
                : null,
            },
            rank && h("td", { class: "rp-rank" }, i + 1),
            block.columns.map((c) => {
              const td = cell(row, c, ...(stats[c.field] ?? []));
              td.dataset.field = c.field;
              return td;
            }),
          ),
        ),
      ),
    );
    const step = block.more ?? block.limit ?? 12;
    const more =
      rows.length > own.shown &&
      h(
        "button",
        { class: "rp-more", onclick: () => ((own.shown += step), draw()) },
        `Show ${Math.min(step, rows.length - own.shown)} more of ${rows.length - own.shown}`,
      );
    wrap.replaceChildren(
      ...(block.search
        ? [
            h("input", {
              class: "rp-search",
              type: "search",
              placeholder: `Search ${rows.length} rows`,
              value: own.query,
              oninput: (e) => {
                const caret = e.target.selectionStart;
                own.query = e.target.value;
                draw();
                const input = wrap.querySelector("input");
                input.focus();
                input.setSelectionRange(caret, caret);
              },
            }),
          ]
        : []),
      h("div", { class: "rp-scroll" }, table),
      more || "",
    );
    return rows.length;
  };
  wrap.count = draw();
  return wrap;
}

function blockEl(block, id) {
  block.__id = id;
  const half =
    block.half ??
    (block.type === "bars" ||
      (block.type === "chart" &&
        !["heatmap"].includes(block.chart) &&
        block.wide !== true &&
        !block.horizontal) ||
      block.type === "vega");
  const wide = block.wide ?? !half;
  const section = h("section", {
    class: `rp-block${wide ? " is-wide" : ""} is-${block.type}`,
    id: block.id ?? null,
  });
  const toggles =
    (block.logToggle &&
      h(
        "div",
        { class: "rp-seg is-small" },
        ["linear", "log"].map((s) =>
          h(
            "button",
            {
              "aria-pressed": String((state.scale[block.__id] ?? "linear") === s),
              onclick: () => ((state.scale[block.__id] = s), render()),
            },
            s === "log" ? "Log" : "Linear",
          ),
        ),
      )) ||
    null;
  let body;
  if (block.type === "stats") body = statsBlock(block);
  else if (block.type === "facts") body = factsBlock(block);
  else if (block.type === "bars") body = barsBlock(block);
  else if (block.type === "matrix" || block.chart === "heatmap") body = matrixBlock(block);
  else if (block.type === "table") body = tableBlock(block);
  else {
    body = h("div", { class: "rp-chart", role: "img", "aria-label": block.title ?? "Chart" });
    charts.push({ block, el: body });
  }
  const count = block.type === "table" && block.style === "rows" ? body.count : null;
  if (block.title || toggles)
    section.append(
      h(
        "header",
        { class: "rp-block-head" },
        h(
          "div",
          {},
          block.title &&
            h(
              "h3",
              {},
              block.title,
              count != null ? h("span", { class: "rp-muted" }, ` ${count} matching`) : null,
            ),
          block.note && h("p", { html: inline(block.note) }),
        ),
        toggles,
      ),
    );
  section.append(body);
  return section;
}

// ---------- page

const root = document.getElementById("report");

function readHash() {
  resetFilters();
  const [view, query] = location.hash.slice(1).split("?");
  if (views.some((v) => v.id === view)) state.view = view;
  for (const [k, v] of new URLSearchParams(query ?? "")) {
    if (k === "q") state.q = v;
    const f = filters.find((f) => f.field === k);
    if (f)
      state.filters[k] =
        kindOf(f) === "toggle"
          ? v === "1"
          : (options(f).find((o) => String(o.value) === v)?.value ?? state.filters[k]);
  }
}
function writeHash() {
  const params = new URLSearchParams();
  for (const f of filters) {
    const v = state.filters[f.field];
    const initial =
      kindOf(f) === "tabs"
        ? (f.default ?? options(f)[0]?.value)
        : kindOf(f) === "toggle"
          ? Boolean(f.default)
          : null;
    if (v !== initial && v != null)
      params.set(f.field, kindOf(f) === "toggle" ? (v ? "1" : "0") : String(v));
  }
  if (state.q) params.set("q", state.q);
  const q = params.toString();
  history.replaceState(null, "", `#${state.view}${q ? `?${q}` : ""}`);
}

function resetFilters() {
  state.q = "";
  for (const f of filters)
    state.filters[f.field] =
      kindOf(f) === "tabs"
        ? (f.default ?? options(f)[0]?.value)
        : kindOf(f) === "toggle"
          ? Boolean(f.default)
          : (f.default ?? null);
}
readHash();

const toggle = (f) =>
  h(
    "label",
    { class: "rp-check" },
    h("input", {
      type: "checkbox",
      checked: state.filters[f.field] || null,
      onchange: (e) => ((state.filters[f.field] = e.target.checked), writeHash(), render()),
    }),
    f.label,
  );

function sidebar() {
  const side = filters.filter((f) => kindOf(f) !== "toggle");
  const toggles = filters.filter((f) => kindOf(f) === "toggle");
  if (!side.length && !toggles.length && !report.search) return null;
  return h(
    "aside",
    { class: "rp-side" },
    h("div", { class: "rp-side-title" }, "Filters"),
    toggles.length > 0 && h("div", { class: "rp-side-toggles" }, toggles.map(toggle)),
    report.search &&
      h(
        "label",
        { class: "rp-side-search" },
        h("span", { html: SEARCH }),
        h("input", {
          type: "search",
          placeholder: report.search === true ? "Search" : report.search,
          value: state.q,
          oninput: (e) => ((state.q = e.target.value), writeHash(), renderSoon()),
        }),
      ),
    side.map((f) => {
      const opts = options(f);
      if (kindOf(f) === "tabs" && opts.length > 5)
        return h(
          "label",
          { class: "rp-side-select" },
          h("span", {}, f.label ?? f.field),
          h(
            "select",
            {
              onchange: (e) => (
                (state.filters[f.field] = opts[e.target.selectedIndex].value),
                writeHash(),
                render()
              ),
            },
            opts.map((o) => h("option", { selected: state.filters[f.field] === o.value }, o.label)),
          ),
        );
      if (kindOf(f) === "tabs")
        return h(
          "div",
          { class: "rp-side-tabs", role: "group", "aria-label": f.label ?? f.field },
          opts.map((o) =>
            h(
              "button",
              {
                "aria-pressed": String(state.filters[f.field] === o.value),
                onclick: () => ((state.filters[f.field] = o.value), writeHash(), render()),
              },
              o.label,
            ),
          ),
        );
      const counts = countsFor(f);
      const sorted = [...opts].sort(
        (a, b) => (counts.get(b.value) ?? 0) - (counts.get(a.value) ?? 0),
      );
      return h(
        "div",
        { class: "rp-side-group" },
        h(
          "div",
          { class: "rp-side-head" },
          h("span", {}, f.label ?? f.field),
          state.filters[f.field] != null &&
            h("button", { onclick: () => setFilter(f.field, state.filters[f.field]) }, "Clear"),
        ),
        h(
          "ul",
          {},
          sorted.map((o) => {
            const n = counts.get(o.value) ?? 0;
            const on = state.filters[f.field] === o.value;
            return h(
              "li",
              {},
              h(
                "button",
                {
                  class: `${on ? "is-on" : ""}${n ? "" : " is-zero"}`,
                  "aria-pressed": String(on),
                  onclick: () => setFilter(f.field, o.value),
                },
                h("i", {
                  class: "rp-dot",
                  style: {
                    background: n
                      ? (colorOf(f.field, o.value) ?? "var(--rp-muted)")
                      : "transparent",
                    borderColor: colorOf(f.field, o.value) ?? "var(--rp-muted)",
                  },
                }),
                h("span", {}, o.label),
                h("span", { class: "rp-count" }, fmt(n, "integer")),
              ),
            );
          }),
        ),
      );
    }),
  );
}

let soon;
const renderSoon = () => {
  clearTimeout(soon);
  soon = setTimeout(() => {
    const focus = document.activeElement?.type === "search";
    void render();
    if (focus) {
      const input = root.querySelector(".rp-side-search input");
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }
  }, 160);
};

function render() {
  const scrollY = window.scrollY;
  charts.length = 0;
  const view = views.find((v) => v.id === state.view);
  document.title = `${view.label} · ${report.title}`;
  const go = (id) => (e) => (
    e.preventDefault(),
    (state.view = id),
    writeHash(),
    render(),
    window.scrollTo({ top: 0 })
  );
  const toggles = filters.filter((f) => kindOf(f) === "toggle");
  const top = h(
    "header",
    { class: "rp-top" },
    h(
      "a",
      { class: "rp-brand", href: `#${views[0].id}`, onclick: go(views[0].id) },
      h("b", {}, report.title),
      report.subtitle && h("span", {}, report.subtitle),
    ),
    h(
      "nav",
      { class: "rp-tabs", "aria-label": "Views" },
      views.map((v) =>
        h(
          "a",
          {
            href: `#${v.id}`,
            "aria-current": v.id === state.view ? "page" : null,
            onclick: go(v.id),
          },
          v.label,
        ),
      ),
    ),
    h(
      "div",
      { class: "rp-top-right" },
      toggles.map(toggle),
      h(
        "div",
        { class: "rp-seg is-theme", role: "group", "aria-label": "Theme" },
        h("button", {
          "aria-pressed": String(theme() === "light"),
          "aria-label": "Light",
          html: SUN,
          onclick: () => setTheme("light"),
        }),
        h("button", {
          "aria-pressed": String(theme() === "dark"),
          "aria-label": "Dark",
          html: MOON,
          onclick: () => setTheme("dark"),
        }),
      ),
    ),
  );
  const blocks = view.method
    ? [
        h("article", {
          class: "rp-method",
          html: markdown([report.intro, report.method].filter(Boolean).join("\n\n")),
        }),
      ]
    : [
        ...(report.top ?? []).map((b, i) => blockEl(b, `top-${i}`)),
        view.summary ? h("p", { class: "rp-summary", html: inline(view.summary) }) : null,
        ...(view.blocks ?? []).map((b, i) => blockEl(b, `${view.id}-${i}`)),
        ...(report.bottom ?? []).map((b, i) => blockEl(b, `bottom-${i}`)),
      ];
  const foot = h(
    "footer",
    { class: "rp-foot" },
    report.source
      ? h(
          "span",
          {},
          "Data: ",
          h(
            "a",
            { href: report.source.url, target: "_blank", rel: "noopener" },
            report.source.label,
          ),
        )
      : null,
    report.updated ? h("span", {}, ` · updated ${report.updated}`) : null,
  );
  const side = view.method ? null : sidebar();
  root.replaceChildren(
    top,
    h(
      "div",
      { class: `rp-layout${side ? "" : " is-full"}` },
      h("main", { class: "rp-main" }, h("div", { class: "rp-grid" }, blocks), foot),
      side,
    ),
  );
  window.scrollTo({ top: scrollY });
  return Promise.all(charts.map(drawChart)).then(() => {
    document.body.dataset.ready = state.view;
  });
}

const SEARCH =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const SUN =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
function setTheme(next) {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("rp-theme", next);
  } catch {}
  void render();
}

let stored = null;
try {
  stored = localStorage.getItem("rp-theme");
} catch {}
document.documentElement.dataset.theme =
  new URLSearchParams(location.search).get("theme") ??
  stored ??
  (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
window.addEventListener("hashchange", () => (readHash(), render()));
let lastWidth = 0;
new ResizeObserver(() => {
  const w = root.clientWidth;
  if (Math.abs(w - lastWidth) < 8) return;
  lastWidth = w;
  clearTimeout(window.__rpResize);
  window.__rpResize = setTimeout(() => Promise.all(charts.map(drawChart)), 120);
}).observe(root);
void render();
window.__report = {
  render,
  state,
  views: views.map((v) => v.id),
  go: (id) => ((state.view = id), (document.body.dataset.ready = ""), render()),
};
