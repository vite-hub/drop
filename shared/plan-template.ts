// Starter HTML plan. Agents copy it, replace the content, and keep the structure.
// It only uses the theme tokens Drop (and T3 Code) inject, so it follows light/dark mode.
export const PLAN_TEMPLATE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plan title</title>
<style>
  .plan { max-width: 760px; margin: 0 auto; padding: 56px 24px 96px; }
  .eyebrow { font: 500 12px/1 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted-foreground); }
  h1 { font-size: 34px; line-height: 1.1; letter-spacing: -0.03em; margin: 12px 0 10px; }
  h2 { font-size: 19px; letter-spacing: -0.015em; margin: 44px 0 12px; }
  .lede { font-size: 17px; color: var(--muted-foreground); margin: 0; max-width: 60ch; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
  .chip { font-size: 12px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted-foreground); }
  .chip.accent { background: var(--accent-surface); color: var(--accent-surface-foreground); border-color: transparent; }
  .callout { border: 1px solid var(--border); border-left: 3px solid var(--accent); background: var(--card); border-radius: var(--radius); padding: 14px 16px; }
  .callout b { display: block; margin-bottom: 2px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
  .stat { border: 1px solid var(--border); background: var(--card); border-radius: var(--radius); padding: 14px; }
  .stat b { display: block; font-size: 24px; letter-spacing: -0.02em; }
  .stat span { font-size: 13px; color: var(--muted-foreground); }
  .panel { border: 1px solid var(--border); background: var(--card); border-radius: var(--radius); padding: 16px; }
  .chart { position: relative; height: 240px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); }
  th { font-weight: 500; color: var(--muted-foreground); }
  .tasks label { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); }
  .tasks label:has(input:checked) span { text-decoration: line-through; color: var(--muted-foreground); }
  .pill { font-size: 12px; padding: 2px 8px; border-radius: 999px; }
  .pill.low { background: var(--muted); } .pill.high { background: var(--destructive-surface); color: var(--destructive); }
</style>
</head>
<body>
<main class="plan">
  <div class="eyebrow">Plan · Draft</div>
  <h1>Plan title</h1>
  <p class="lede">One or two sentences: what changes, for whom, and why now.</p>
  <div class="meta"><span class="chip accent">Needs review</span><span class="chip">Owner: Claude Code</span><span class="chip">3 PRs</span></div>

  <h2>Decision</h2>
  <div class="callout"><b>Recommendation</b>Ship it in three stacked PRs, each behind a preview deploy.</div>

  <h2>At a glance</h2>
  <div class="grid">
    <div class="stat"><b>3</b><span>pull requests</span></div>
    <div class="stat"><b>2 days</b><span>estimated</span></div>
    <div class="stat"><b>Low</b><span>rollback risk</span></div>
  </div>

  <h2>Impact</h2>
  <div class="panel"><div class="chart"><canvas id="impact"></canvas></div></div>

  <h2>How it fits</h2>
  <div class="panel"><pre class="mermaid">flowchart LR
  Agent -->|drops| Plan --> Review{{Comments}} -->|next version| Agent</pre></div>

  <h2>Tasks</h2>
  <div class="tasks">
    <label><input type="checkbox" checked><span>Write the plan</span></label>
    <label><input type="checkbox"><span>Get review comments</span></label>
    <label><input type="checkbox"><span>Drop the next version</span></label>
  </div>

  <h2>Risks</h2>
  <table>
    <thead><tr><th>Risk</th><th>Severity</th><th>Mitigation</th></tr></thead>
    <tbody>
      <tr><td>Migration fails on D1</td><td><span class="pill high">High</span></td><td>Dry-run on a preview database</td></tr>
      <tr><td>Copy confuses users</td><td><span class="pill low">Low</span></td><td>Review with one real user</td></tr>
    </tbody>
  </table>
</main>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.min.js"></script>
<script type="module">
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  Chart.defaults.color = css("--muted-foreground");
  Chart.defaults.borderColor = css("--border");
  Chart.defaults.font.family = css("--font-sans");
  new Chart(document.getElementById("impact"), {
    type: "bar",
    data: {
      labels: ["Week 1", "Week 2", "Week 3", "Week 4"],
      datasets: [
        { label: "Before", data: [12, 14, 13, 15], backgroundColor: css("--chart-2"), borderRadius: 6 },
        { label: "After", data: [12, 9, 6, 4], backgroundColor: css("--chart-1"), borderRadius: 6 }
      ]
    },
    options: { maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
  });
  const { default: mermaid } = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: document.documentElement.classList.contains("dark") ? "dark" : "neutral" });
  await mermaid.run({ querySelector: "pre.mermaid" });
</script>
</body>
</html>`;
