// Headless AI eval runner: bundles harness.ts, runs every (map, seed) pair in parallel child
// processes, and prints per-map averages (with deltas vs baseline.json when present).
//
//   npm run sim:ai -- [--seconds 180] [--seeds 3] [--maps preset-kenny-park,...] [--jobs 4]
//                     [--label name] [--save-baseline]
//   npm run sim:ai -- --check-geometry      (spot table vs meshes self-test only)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const BUILD = path.join(HERE, ".build");
const RESULTS = path.join(HERE, "results");
const BASELINE = path.join(HERE, "baseline.json");

const args = parseArgs(process.argv.slice(2));
const seconds = Number(args.seconds ?? 180);
const seeds = Number(args.seeds ?? 3);
const jobs = Number(args.jobs ?? Math.max(1, Math.min(6, os.cpus().length - 1)));
const label = args.label ?? new Date().toISOString().replace(/[:.]/g, "-");

const harness = await bundle();
if (args["check-geometry"]) {
  // Every spot model × 4 rotations on a synthetic map: the GRIND_LINES / RAMPS tables must
  // match the meshes, or the AI aims at air. Also runs automatically after every eval.
  const r = await runOne({ map: "__catalog__", seed: 1 }, 0);
  if (r.error) throw new Error(r.error);
  report(r);
  process.exit(r.spots.geometryMisses.length ? 1 : 0);
}
const { PRESET_IDS } = await import(pathToUrl(harness.replace(/harness\.mjs$/, "presets.mjs")));
const maps = args.maps ? String(args.maps).split(",") : PRESET_IDS;

const tasks = maps.flatMap((map) => Array.from({ length: seeds }, (_, i) => ({ map, seed: i + 1 })));
console.log(`ai-sim: ${tasks.length} runs (${maps.length} maps × ${seeds} seeds × ${seconds}s sim), ${jobs} parallel`);
const t0 = Date.now();
const runs = await pool(tasks, jobs, runOne);
const failed = runs.filter((r) => r.error);
for (const f of failed) console.error(`\n[FAIL] ${f.map} seed ${f.seed}\n${f.error}`);
const ok = runs.filter((r) => !r.error);
if (!ok.length) process.exit(1);

const geom = await runOne({ map: "__catalog__", seed: 1 }, 0);
if (geom.error) console.error(geom.error);
else report(geom);
const summary = summarize(ok);
const baseline = fs.existsSync(BASELINE) && !args["save-baseline"] ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;
printTable(summary, baseline);
console.log(`\nwall time ${((Date.now() - t0) / 1000).toFixed(1)}s${failed.length ? `, ${failed.length} FAILED` : ""}`);

const out = { label, seconds, seeds, maps, createdAt: new Date().toISOString(), summary, runs: ok };
fs.mkdirSync(RESULTS, { recursive: true });
fs.writeFileSync(path.join(RESULTS, `${label}.json`), JSON.stringify(out, null, 2));
if (args["save-baseline"]) {
  fs.writeFileSync(BASELINE, JSON.stringify({ ...out, runs: undefined }, null, 2) + "\n");
  console.log(`baseline saved → ${path.relative(ROOT, BASELINE)}`);
}
process.exit(failed.length ? 1 : 0);

// ---------------------------------------------------------------------------

async function bundle() {
  const require = createRequire(path.join(ROOT, "package.json"));
  const esbuild = require("esbuild"); // ships with vite
  fs.mkdirSync(BUILD, { recursive: true });
  const common = {
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "warning",
    define: { "import.meta.env.DEV": "false", "import.meta.env.BASE_URL": '"/"' },
    // Some bundled CJS deps (recast-detour) call require() for node builtins.
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
    plugins: [
      {
        name: "pocket-skater",
        setup(b) {
          // Particles need a canvas (DynamicTexture) — physics/AI never read them.
          b.onResolve({ filter: /^@\/engine\/effects\/Particles$/ }, () => ({ path: "fx", namespace: "stub" }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents: "export class SkateFX { constructor() {} setGrinding() {} setSpeed() {} burstPoof() {} dispose() {} }",
            loader: "js",
          }));
        },
      },
    ],
    tsconfig: path.join(ROOT, "tsconfig.app.json"),
  };
  await esbuild.build({ ...common, entryPoints: [path.join(HERE, "harness.ts")], outfile: path.join(BUILD, "harness.mjs") });
  await esbuild.build({
    ...common,
    stdin: { contents: 'import { PRESET_MAPS } from "@/data/presets"; export const PRESET_IDS = PRESET_MAPS.map((m) => m.id);', resolveDir: ROOT, loader: "ts" },
    outfile: path.join(BUILD, "presets.mjs"),
  });
  return path.join(BUILD, "harness.mjs");
}

function report(r) {
  const m = r.spots.geometryMisses;
  console.log(`geometry self-test (${r.spots.grind} lines, ${r.spots.ramp} ramps): ${m.length ? m.length + " MISSES" : "ok"}`);
  for (const x of m) console.log("  " + x);
}

function runOne({ map, seed }, secs = seconds) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [harness, ROOT, map, String(seed), String(secs)], { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
      process.stdout.write(line ? "." : "x");
      if (code === 0 && line) resolve(JSON.parse(line.slice(7)));
      else resolve({ map, seed, error: `exit ${code}\n${stderr.slice(-2000) || stdout.slice(-2000)}` });
    });
  });
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  process.stdout.write("\n");
  return out;
}

/** Per-map means, normalized per minute where it makes sense, plus an all-maps row. */
function summarize(runs) {
  const metrics = (rs) => {
    const mean = (f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
    const perMin = (k) => mean((r) => (r[k] / r.seconds) * 60);
    const jumps = rs.reduce((a, r) => a + Number(r.ai.jumpsFired ?? 0), 0);
    const lands = rs.reduce((a, r) => a + Number(r.ai.airSuccess ?? 0), 0);
    const sMean = mean((r) => r.scorePerMin);
    const sVar = rs.length > 1 ? rs.reduce((a, r) => a + (r.scorePerMin - sMean) ** 2, 0) / (rs.length - 1) : 0;
    return {
      runs: rs.length,
      scorePerMin: sMean,
      /** Standard error of the mean — seed variance is large, so read deltas against this. */
      scorePerMinSE: Math.sqrt(sVar / rs.length),
      grindSecPerMin: perMin("grindSec"),
      longestGrind: mean((r) => r.longestGrind),
      airsPerMin: perMin("airs"),
      /** Share of the run spent in a scoring trick (grinding, or airborne on an air that scored). */
      trickPct: mean((r) => (((r.grindSec ?? 0) + (r.airSec ?? 0)) / r.seconds) * 100),
      bailsPerMin: perMin("bails"),
      unsticksPerMin: perMin("unsticks"),
      impactsPerMin: mean((r) => ((r.impacts ?? 0) / r.seconds) * 60),
      farmResetsPerMin: mean((r) => ((r.farmResets ?? 0) / r.seconds) * 60),
      railImpactsPerMin: mean((r) => ((r.railImpacts ?? 0) / r.seconds) * 60),
      slowPct: mean((r) => (r.slowSec / r.seconds) * 100),
      spotsPct: mean((r) => (r.spotsUsed / Math.max(1, r.spotsTotal)) * 100),
      hotspotPct: mean((r) => r.hotspotShare * 100),
      coveragePct: mean((r) => r.coverage * 100),
      railLandPct: jumps ? (lands / jumps) * 100 : 0,
      plansPerMin: mean((r) => (Number(r.ai.plans ?? 0) / r.seconds) * 60),
    };
  };
  const byMap = {};
  for (const r of runs) (byMap[r.map] ??= []).push(r);
  const summary = Object.fromEntries(Object.entries(byMap).map(([k, rs]) => [k, metrics(rs)]));
  summary["ALL"] = metrics(runs);
  return summary;
}

function printTable(summary, baseline) {
  const cols = [
    ["scorePerMin", "score/min", 0, +1],
    ["scorePerMinSE", "±se", 0, 0],
    ["grindSecPerMin", "grind s/min", 1, +1],
    ["longestGrind", "longest s", 2, +1],
    ["airsPerMin", "airs/min", 1, +1],
    ["trickPct", "trick %", 0, +1],
    ["railLandPct", "rail land %", 0, +1],
    ["spotsPct", "spots %", 0, +1],
    ["coveragePct", "cover %", 0, +1],
    ["hotspotPct", "hotspot %", 0, -1],
    ["slowPct", "slow %", 0, -1],
    ["unsticksPerMin", "unstick/min", 2, -1],
    ["impactsPerMin", "knocks/min", 1, -1],
    ["railImpactsPerMin", "rail knk/min", 1, -1],
    ["farmResetsPerMin", "farm rst/min", 2, -1],
    ["bailsPerMin", "bails/min", 2, -1],
  ];
  const w = 14;
  console.log("\n" + "map".padEnd(16) + cols.map(([, h]) => h.padStart(w)).join(""));
  for (const [map, s] of Object.entries(summary)) {
    let row = map.padEnd(16);
    for (const [k, , dp, better] of cols) {
      let cell = s[k].toFixed(dp);
      const b = baseline?.summary?.[map]?.[k];
      if (typeof b === "number" && better !== 0) {
        const d = s[k] - b;
        if (Math.abs(d) >= 10 ** -dp / 2) cell += `${d > 0 ? "+" : ""}${d.toFixed(dp)}${d * better > 0 ? "↑" : "↓"}`;
      }
      row += cell.padStart(w);
    }
    console.log(row);
  }
  if (baseline) console.log(`(deltas vs baseline "${baseline.label}"; ↑ = better, ↓ = worse)`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2);
    out[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return out;
}

function pathToUrl(p) {
  return "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");
}
