#!/usr/bin/env node

// src/cli.ts
import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import path4 from "path";
import os2 from "os";
import fs2 from "fs/promises";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

// src/githubPartialSubtree.ts
import path from "path";
import fs from "fs/promises";
function createSemaphore(max) {
  let running = 0;
  const queue = [];
  const next = () => {
    running--;
    const fn = queue.shift();
    if (fn) fn();
  };
  return async (fn) => new Promise((resolve, reject) => {
    const run2 = async () => {
      running++;
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      } finally {
        next();
      }
    };
    if (running < max) run2();
    else queue.push(run2);
  });
}
async function fetchJson(url, signal, verbose) {
  verbose && console.error(`[debug] GET ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": "@pnp/spfx-sample" }, signal });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 403 && res.headers.get("X-RateLimit-Remaining") === "0") {
      throw new Error(
        "GitHub anonymous rate limit hit (60/hr per IP). Try again later, or install/use the git method."
      );
    }
    throw new Error(`GitHub API error: ${data?.message ?? `${res.status} ${res.statusText}`}`);
  }
  return data;
}
async function fetchTree(owner, repo, treeish, recursive = false, signal, verbose) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(treeish)}${recursive ? "?recursive=1" : ""}`;
  return fetchJson(url, signal, verbose);
}
async function ensureDirForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}
async function downloadSampleViaGitHubSubtree(opts) {
  const { owner, repo, ref, sampleFolder, destDir } = opts;
  const concurrency = opts.concurrency ?? 8;
  const signal = opts.signal;
  if (signal?.aborted) throw new Error("Download aborted");
  const root = await fetchTree(owner, repo, ref, false, opts.signal, opts.verbose);
  if (root.message) throw new Error(root.message);
  const samplesTree = root.tree.find((t) => t.type === "tree" && t.path === "samples");
  if (!samplesTree) throw new Error(`Could not find /samples at ${owner}/${repo}@${ref}`);
  const samples = await fetchTree(owner, repo, samplesTree.sha, false, opts.signal, opts.verbose);
  const sampleTree = samples.tree.find((t) => t.type === "tree" && t.path === sampleFolder);
  if (!sampleTree) throw new Error(`Sample folder not found: samples/${sampleFolder} at ${ref}`);
  const sample = await fetchTree(owner, repo, sampleTree.sha, true, opts.signal, opts.verbose);
  if (sample.truncated) {
    throw new Error(`Tree listing truncated for samples/${sampleFolder}. Use the git method.`);
  }
  const blobs = sample.tree.filter((t) => t.type === "blob");
  if (blobs.length === 0) throw new Error(`No files found in samples/${sampleFolder}`);
  await fs.mkdir(destDir, { recursive: true });
  const sem = createSemaphore(concurrency);
  let done = 0;
  await Promise.all(
    blobs.map(
      (b) => sem(async () => {
        const rel = b.path;
        const fullRepoPath = `samples/${sampleFolder}/${rel}`;
        if (opts.signal?.aborted) throw new Error("Download aborted");
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${fullRepoPath}`;
        opts.verbose && console.error(`[debug] GET ${rawUrl}`);
        const res = await fetch(rawUrl, { signal: opts.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${fullRepoPath}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const outPath = path.join(destDir, rel);
        await ensureDirForFile(outPath);
        await fs.writeFile(outPath, bytes);
        done++;
        opts.onProgress?.(done, blobs.length, fullRepoPath);
      })
    )
  );
}

// src/cli.ts
import ProgressBar from "progress";

// src/detectVersionManagers.ts
import { access } from "fs/promises";
import { spawnSync } from "child_process";
import os from "os";
import path2 from "path";
async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
function which(cmd) {
  const runner = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [cmd] : ["-v", cmd];
  try {
    const res = spawnSync(runner, args, { encoding: "utf8", shell: false });
    if (res.status === 0) {
      const out = (res.stdout || res.stderr || "").split(/\r?\n/).find(Boolean);
      return out ? out.trim() : null;
    }
  } catch {
  }
  return null;
}
async function detectVersionManagers() {
  const found = { nvmPosix: false, nvmPosixDir: null, nvmWindows: false, nvmWindowsPath: null, nvs: false, nvsPath: null };
  if (process.env.NVM_DIR) {
    found.nvmPosix = true;
    found.nvmPosixDir = process.env.NVM_DIR;
  } else {
    const maybe = path2.join(os.homedir(), ".nvm");
    if (await exists(maybe)) {
      found.nvmPosix = true;
      found.nvmPosixDir = maybe;
    }
  }
  if (process.env.NVM_HOME || process.env.NVM_SYMLINK) {
    found.nvmWindows = true;
    found.nvmWindowsPath = process.env.NVM_HOME ?? process.env.NVM_SYMLINK ?? null;
  } else {
    const w = which(process.platform === "win32" ? "nvm.exe" : "nvm");
    if (w) {
      if (process.platform === "win32" || w.toLowerCase().endsWith("nvm.exe")) {
        found.nvmWindows = true;
        found.nvmWindowsPath = w;
      }
    }
  }
  if (process.env.NVS_HOME) {
    found.nvs = true;
    found.nvsPath = process.env.NVS_HOME;
  } else {
    const n = which("nvs");
    if (n) {
      found.nvs = true;
      found.nvsPath = n;
    }
  }
  return found;
}
var detectVersionManagers_default = detectVersionManagers;

// src/detectServeCommand.ts
import { readFile } from "fs/promises";
import path3 from "path";
async function detectServeCommand(projectDir) {
  const pkgPath = path3.join(projectDir, "package.json");
  try {
    const txt = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(txt);
    if (pkg.scripts) {
      if (pkg.scripts.start) return { cmd: "npm", args: ["run", "start"] };
      if (pkg.scripts.serve) return { cmd: "npm", args: ["run", "serve"] };
    }
    const deps = { ...pkg.dependencies || {}, ...pkg.devDependencies || {} };
    if (deps.heft || deps["@microsoft/heft"]) {
      return { cmd: "npm", args: ["run", "start"] };
    }
    if (deps.gulp || deps["gulp-cli"]) {
      return { cmd: "gulp", args: ["serve"] };
    }
  } catch {
  }
  try {
    const gf = path3.join(projectDir, "gulpfile.js");
    await readFile(gf, "utf8");
    return { cmd: "gulp", args: ["serve"] };
  } catch {
  }
  return { cmd: "npm", args: ["run", "serve"] };
}
var detectServeCommand_default = detectServeCommand;

// src/cli.ts
import https from "https";
var DEFAULT_OWNER = "pnp";
var DEFAULT_REPO = "sp-dev-fx-webparts";
var DEFAULT_REF = "main";
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Promise rejection:", reason);
  process.exitCode = 1;
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err.message || err);
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
});
function normalizeSampleArg(sample) {
  const s = sample.replaceAll("\\", "/").trim();
  if (s.startsWith("samples/")) return s.slice("samples/".length);
  return s;
}
async function pathExists(p) {
  try {
    await fs2.access(p);
    return true;
  } catch {
    return false;
  }
}
async function isDirNonEmpty(p) {
  try {
    const entries = await fs2.readdir(p);
    return entries.length > 0;
  } catch {
    return false;
  }
}
async function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    if (opts.verbose) console.error(`[debug] spawn: ${cmd} ${args.join(" ")} cwd=${opts.cwd ?? process.cwd()}`);
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (opts.signal) {
      if (opts.signal.aborted) {
        child.kill();
      } else {
        const onAbort = () => {
          try {
            child.kill();
          } catch {
          }
        };
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      if (opts.verbose) process.stdout.write(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      if (opts.verbose) process.stderr.write(s);
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(" ")} failed (exit ${code}).
${stderr || stdout}`));
    });
  });
}
function parseGitVersion(output) {
  const m = output.match(/git version (\d+)\.(\d+)\.(\d+)/i);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}
function versionGte(v, min) {
  if (v.major !== min.major) return v.major > min.major;
  if (v.minor !== min.minor) return v.minor > min.minor;
  return v.patch >= min.patch;
}
async function ensureGit(verbose) {
  let res;
  try {
    res = await run("git", ["--version"], { verbose });
  } catch {
    throw new Error(
      "Git was not found on PATH. Install Git for Windows (or your platform) and try again."
    );
  }
  const v = parseGitVersion(res.stdout.trim());
  if (!v) return;
  const min = { major: 2, minor: 25, patch: 0 };
  if (!versionGte(v, min)) {
    throw new Error(
      `Git ${v.major}.${v.minor}.${v.patch} is too old. Please upgrade to >= 2.25 for sparse-checkout cone mode.`
    );
  }
}
async function isGitAvailable(verbose) {
  try {
    await run("git", ["--version"], { verbose });
    return true;
  } catch {
    return false;
  }
}
function assertMethod(m) {
  if (!m) return "auto";
  if (m === "auto" || m === "git" || m === "api") return m;
  throw new Error(`Invalid --method "${m}". Use "auto", "git", or "api".`);
}
async function copyDir(src, dest) {
  await fs2.mkdir(dest, { recursive: true });
  const fsp = fs2;
  if (typeof fsp.cp === "function") {
    await fsp.cp(src, dest, { recursive: true });
    return;
  }
  const entries = await fs2.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path4.join(src, e.name);
    const d = path4.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs2.copyFile(s, d);
  }
}
async function sparseCloneInto(args) {
  const { owner, repo, ref, sampleFolder, repoDir, verbose, spinner } = args;
  const repoUrl = `https://github.com/${owner}/${repo}.git`;
  const sparsePath = `samples/${sampleFolder}`.replaceAll("\\", "/");
  spinner && (spinner.text = `Cloning (partial) ${owner}/${repo}\u2026`);
  await run(
    "git",
    ["clone", "--depth=1", "--filter=blob:none", "--no-checkout", repoUrl, repoDir],
    { verbose, signal: args.signal }
  );
  spinner && (spinner.text = `Enabling sparse checkout\u2026`);
  await run("git", ["-C", repoDir, "sparse-checkout", "init", "--cone"], { verbose, signal: args.signal });
  spinner && (spinner.text = `Selecting ${sparsePath}\u2026`);
  await run("git", ["-C", repoDir, "sparse-checkout", "set", sparsePath], { verbose, signal: args.signal });
  spinner && (spinner.text = `Switching to ${ref} branch\u2026`);
  await run("git", ["-C", repoDir, "fetch", "--depth=1", "--filter=blob:none", "origin", ref], {
    verbose,
    signal: args.signal
  });
  spinner && (spinner.text = `Getting sample from ${ref} branch\u2026`);
  await run("git", ["-C", repoDir, "checkout", "--detach", "FETCH_HEAD"], { verbose, signal: args.signal });
  const srcSampleDir = path4.join(repoDir, "samples", sampleFolder);
  if (!await pathExists(srcSampleDir) || !await isDirNonEmpty(srcSampleDir)) {
    throw new Error(`Sample not found or empty: ${owner}/${repo}@${ref} \u2192 samples/${sampleFolder}`);
  }
}
async function fetchSampleViaSparseGitExtract(args) {
  const { owner, repo, ref, sampleFolder, destDir, verbose, spinner } = args;
  const tmpRoot = await fs2.mkdtemp(path4.join(os2.tmpdir(), "spfx-sample-"));
  const tmpRepoDir = path4.join(tmpRoot, "repo");
  try {
    await sparseCloneInto({ owner, repo, ref, sampleFolder, repoDir: tmpRepoDir, verbose, spinner, signal: args.signal });
    const srcSampleDir = path4.join(tmpRepoDir, "samples", sampleFolder);
    spinner && (spinner.text = `Copying sample to ${destDir}\u2026`);
    await copyDir(srcSampleDir, destDir);
  } finally {
    await fs2.rm(tmpRoot, { recursive: true, force: true }).catch(() => void 0);
  }
}
async function readNvmrc(root) {
  const p = path4.join(root, ".nvmrc");
  try {
    const txt = await fs2.readFile(p, "utf8");
    const v = txt.split(/\r?\n/)[0].trim();
    return v || null;
  } catch {
    return null;
  }
}
function parseNodeVersion(v) {
  if (!v) return null;
  const s = v.trim().replace(/^v/, "");
  const parts = s.split(".").map((p) => Number(p || 0));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
}
function getCurrentNodeVersion() {
  const v = process.version.replace(/^v/, "");
  const parts = v.split(".").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}
async function maybePrintNvmrcAdvice(sampleRoot) {
  const nvmrc = await readNvmrc(sampleRoot);
  const debug = typeof process.env.SPFX_SAMPLE_DEBUG !== "undefined";
  const dbg = (msg) => {
    if (debug) console.error("[spfx-debug]", msg);
  };
  if (debug) console.error("[spfx-debug] maybePrintNvmrcAdvice invoked for: " + sampleRoot);
  if (nvmrc) {
    dbg(`.nvmrc found: ${nvmrc}`);
    const required = parseNodeVersion(nvmrc);
    const current = getCurrentNodeVersion();
    if (!required || !current) return;
    if (current.major !== required.major) {
      console.log();
      console.log(chalk.yellow(`This sample suggests Node ${nvmrc} (from .nvmrc).`));
      console.log(chalk.yellow(`Your current Node is ${process.version}.`));
      try {
        const dm = await detectVersionManagers_default();
        const choices = [];
        if (dm.nvmPosix) choices.push(`${chalk.yellow("nvm")} ${chalk.white("use")} ${chalk.white(nvmrc)}`);
        if (dm.nvmWindows) choices.push(`${chalk.yellow("nvm")} ${chalk.white("use")} ${chalk.white(nvmrc)}`);
        if (dm.nvs) choices.push(`${chalk.yellow("nvs")} ${chalk.white("use")} ${chalk.white(nvmrc)}`);
        if (choices.length === 0) {
          console.log(chalk.yellow("Consider installing a Node version manager such as nvm, nvm-windows, or nvs."));
        }
        if (choices.length > 0) {
          console.log();
          console.log(chalk.yellow("You can switch to the required Node version with:"));
        }
        if (choices.length === 1) {
          console.log(`  ${choices[0]}`);
        } else if (choices.length > 1) {
          console.log(`  ${choices[0]}`);
          for (let i = 1; i < choices.length; i++) {
            console.log(chalk.yellow("or:"));
            console.log(`  ${choices[i]}`);
          }
        }
        console.log();
        console.log(chalk.yellow("Then:"));
      } catch {
      }
    }
    return;
  }
  try {
    let parseSemverLoose2 = function(s) {
      if (!s) return null;
      const cleaned = s.trim().replace(/^[^0-9]*/, "").replace(/[^0-9.].*$/, "");
      const parts = cleaned.split(".").map((p) => Number(p || 0));
      if (parts.some((n) => Number.isNaN(n))) return null;
      return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
    }, pickHighest2 = function(list) {
      let b = null;
      for (const v of list) {
        const sem = parseSemverLoose2(v.ver);
        if (!sem) continue;
        if (!b) b = { pkg: v.pkg, ver: v.ver, sem };
        else {
          if (sem.major > b.sem.major || sem.major === b.sem.major && (sem.minor > b.sem.minor || sem.minor === b.sem.minor && sem.patch > b.sem.patch)) {
            b = { pkg: v.pkg, ver: v.ver, sem };
          }
        }
      }
      return b;
    }, semKey2 = function(s) {
      const m = s.replace(/^[^0-9]*/, "").match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
      if (!m) return null;
      return { major: Number(m[1]), minor: Number(m[2] || 0), patch: Number(m[3] || 0) };
    };
    var parseSemverLoose = parseSemverLoose2, pickHighest = pickHighest2, semKey = semKey2;
    const pkg = await readJsonIfExists(path4.join(sampleRoot, "package.json"));
    if (!pkg) {
      dbg("no package.json found");
      return;
    }
    const deps = { ...pkg.dependencies || {}, ...pkg.devDependencies || {} };
    dbg(`found ${Object.keys(deps).length} deps`);
    const spfxPkgs = Object.keys(deps).filter((k) => k.startsWith("@microsoft/sp-"));
    const versions = [];
    for (const p of spfxPkgs) {
      const raw = deps[p];
      if (typeof raw === "string") {
        versions.push({ pkg: p, ver: raw });
      }
    }
    if (versions.length === 0) {
      dbg("no @microsoft/sp- packages found");
      return;
    }
    const preferredOrder = ["@microsoft/sp-webpart-base", "@microsoft/sp-core-library", "@microsoft/sp-module-interfaces"];
    let best = null;
    const preferredCandidates = versions.filter((v) => preferredOrder.includes(v.pkg));
    if (preferredCandidates.length > 0) {
      best = pickHighest2(preferredCandidates);
    }
    if (!best) {
      best = pickHighest2(versions);
    }
    if (!best || !best.sem) {
      dbg("could not parse semver from spfx packages");
      return;
    }
    const matrixUrl = "https://github.com/SharePoint/sp-dev-docs/raw/main/assets/spfx/spfx-matrix.json";
    const matrix = await fetchJsonUrl(matrixUrl);
    if (!matrix) {
      dbg("could not fetch or parse spfx matrix");
      return;
    }
    const entries = [];
    if (Array.isArray(matrix)) {
      for (const e of matrix) {
        if (!e) continue;
        const sp = e.spfx || e.spfxVersion || e.version;
        const node = e.node || e.nodeVersion || (Array.isArray(e.nodeVersions) ? e.nodeVersions[0] : void 0) || e.recommendedNode;
        if (sp) entries.push({ spfx: String(sp), node: node ? String(node) : void 0 });
      }
    } else if (typeof matrix === "object") {
      for (const k of Object.keys(matrix)) {
        const val = matrix[k];
        if (val && typeof val === "object") {
          const node = val.node || val.nodeVersion || (Array.isArray(val.nodeVersions) ? val.nodeVersions[0] : void 0) || val.recommendedNode;
          entries.push({ spfx: k, node: node ? String(node) : void 0 });
        } else if (typeof val === "string") {
          entries.push({ spfx: k, node: val });
        }
      }
    }
    if (entries.length === 0) {
      dbg("no entries parsed from matrix");
      return;
    }
    let bestEntry = null;
    let bestScore = Number.MAX_SAFE_INTEGER;
    for (const e of entries) {
      const sem = semKey2(e.spfx);
      if (!sem) continue;
      if (sem.major === best.sem.major && sem.minor === best.sem.minor && sem.patch === best.sem.patch) {
        bestEntry = e;
        break;
      }
      const score = Math.abs(sem.major - best.sem.major) * 1e4 + Math.abs(sem.minor - best.sem.minor) * 100 + Math.abs(sem.patch - best.sem.patch);
      if (score < bestScore) {
        bestScore = score;
        bestEntry = e;
      }
    }
    if (bestEntry && bestEntry.node) {
      console.log();
      console.log(chalk.yellow(`\u26A0\uFE0F This sample appears to use SharePoint Framework ${best.sem.major}.${best.sem.minor}.${best.sem.patch} (detected from ${best.pkg}).`));
      console.log(chalk.yellow(`A suitable Node version is ${bestEntry.node}. See http://aka.ms/spfx-matrix for details.`));
      try {
        const current = getCurrentNodeVersion();
        const recMatch = String(bestEntry.node).match(/v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
        const recSem = recMatch ? { major: Number(recMatch[1]), minor: Number(recMatch[2] || 0), patch: Number(recMatch[3] || 0) } : null;
        if (current && recSem && current.major !== recSem.major) {
          console.log();
          console.log(chalk.yellow(`Your current Node is ${process.version}.`));
          const dm = await detectVersionManagers_default();
          const choices = [];
          const useVer = recMatch ? `${recSem.major}${recSem.minor ? `.${recSem.minor}` : ""}${recSem.patch ? `.${recSem.patch}` : ""}` : String(bestEntry.node);
          if (dm.nvmPosix) choices.push(`${chalk.yellow("nvm")} ${chalk.white("use")} ${chalk.white(useVer)}`);
          if (dm.nvmWindows) choices.push(`${chalk.yellow("nvm")} ${chalk.white("use")} ${chalk.white(useVer)}`);
          if (dm.nvs) choices.push(`${chalk.yellow("nvs")} ${chalk.white("use")} ${chalk.white(useVer)}`);
          if (choices.length === 0) {
            console.log(chalk.yellow("Consider installing a Node version manager such as nvm, nvm-windows, or nvs."));
          } else {
            console.log();
            console.log(chalk.yellow("You can switch to the recommended Node version with:"));
            for (let i = 0; i < choices.length; i++) {
              if (i > 0) console.log(chalk.yellow("or:"));
              console.log(`  ${choices[i]}`);
            }
            console.log();
            console.log(chalk.yellow("Then:"));
          }
        }
      } catch {
      }
    }
  } catch {
  }
}
async function fetchJsonUrl(url) {
  const maxRedirects = 5;
  return new Promise((resolve) => {
    let redirects = 0;
    const doGet = (u) => {
      try {
        const req = https.get(u, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirects++ < maxRedirects) {
              const loc = res.headers.location.startsWith("http") ? res.headers.location : new URL(res.headers.location, u).toString();
              res.resume();
              doGet(loc);
              return;
            }
            resolve(null);
            res.resume();
            return;
          }
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            resolve(null);
            res.resume();
            return;
          }
          const chunks = [];
          res.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
          res.on("end", () => {
            try {
              const txt = Buffer.concat(chunks).toString("utf8");
              const j = JSON.parse(txt);
              resolve(j);
            } catch {
              resolve(null);
            }
          });
        });
        req.on("error", () => resolve(null));
        req.setTimeout(5e3, () => {
          req.destroy();
          resolve(null);
        });
      } catch {
        resolve(null);
      }
    };
    doGet(url);
  });
}
async function getSpfxMatrix() {
  const cacheDir = path4.join(os2.tmpdir(), "spfx-sample-cli");
  const cacheFile = path4.join(cacheDir, "spfx-matrix.json");
  const ttlMs = 1e3 * 60 * 60 * 24;
  try {
    const st = await fs2.stat(cacheFile).catch(() => null);
    if (st && Date.now() - st.mtimeMs < ttlMs) {
      const txt = await fs2.readFile(cacheFile, "utf8").catch(() => null);
      if (txt) return JSON.parse(txt);
    }
  } catch {
  }
  const url = "https://raw.githubusercontent.com/SharePoint/sp-dev-docs/main/assets/spfx/spfx-matrix.json";
  const j = await fetchJsonUrl(url);
  if (j) {
    try {
      await fs2.mkdir(cacheDir, { recursive: true });
      await fs2.writeFile(cacheFile, JSON.stringify(j, null, 2), "utf8");
    } catch {
    }
  }
  return j;
}
async function finalizeExtraction(opts) {
  const { spinner, successMessage, projectPath, repoRoot } = opts;
  spinner && spinner.succeed(successMessage);
  console.log();
  console.log(chalk.green("Next steps:"));
  console.log(`  ${chalk.yellow("cd")} ${chalk.blue(`"${projectPath}"`)} `);
  if (typeof process.env.SPFX_SAMPLE_DEBUG !== "undefined") console.error("[spfx-debug] calling maybePrintNvmrcAdvice for: " + projectPath);
  await maybePrintNvmrcAdvice(projectPath);
  console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("i")}`));
  console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("run build")}`));
  try {
    const serve = await detectServeCommand_default(projectPath);
    console.log(chalk.white(`  ${chalk.yellow(serve.cmd)} ${chalk.white(serve.args?.join(" ") ?? "")}`));
  } catch {
    console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("run serve")}`));
  }
  if (repoRoot) {
    console.log();
    console.log(chalk.green("Contribute back:"));
    console.log(`  ${chalk.yellow("cd")} ${chalk.blue(`"${repoRoot}"`)} `);
    console.log(chalk.white(`  ${chalk.yellow("git")} ${chalk.white("status")}`));
    console.log(chalk.white(`  ${chalk.yellow("git")} ${chalk.white("checkout")} ${chalk.gray("-b")} ${chalk.white("my-change")}`));
  }
}
function assertMode(m) {
  if (!m) return "extract";
  if (m === "extract" || m === "repo") return m;
  throw new Error(`Invalid --mode "${m}". Use "extract" or "repo".`);
}
function isGuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}
async function readJsonIfExists(filePath) {
  try {
    const txt = await fs2.readFile(filePath, "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}
async function writeJsonPretty(filePath, obj) {
  await fs2.writeFile(filePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}
async function renameSpfxProject(projectDir, opts) {
  const pkgPath = path4.join(projectDir, "package.json");
  const pkg = await readJsonIfExists(pkgPath);
  const oldName = pkg?.name;
  if (pkg && opts.rename) {
    pkg.name = opts.rename;
    await writeJsonPretty(pkgPath, pkg);
  }
  const yoPath = path4.join(projectDir, ".yo-rc.json");
  const yo = await readJsonIfExists(yoPath);
  const gen = yo?.["@microsoft/generator-sharepoint"];
  if (yo && gen) {
    if (opts.rename) {
      if (typeof gen.libraryName === "string") gen.libraryName = opts.rename;
      if (typeof gen.solutionName === "string") gen.solutionName = opts.rename;
    }
    if (opts.newId && typeof gen.libraryId === "string") {
      gen.libraryId = opts.newId;
    }
    await writeJsonPretty(yoPath, yo);
  }
  const psPath = path4.join(projectDir, "config", "package-solution.json");
  const ps = await readJsonIfExists(psPath);
  if (ps?.solution) {
    if (opts.rename && typeof ps.solution.name === "string" && oldName) {
      ps.solution.name = ps.solution.name.replace(new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), opts.rename);
    }
    if (opts.newId && typeof ps.solution.id === "string") {
      ps.solution.id = opts.newId;
    }
    await writeJsonPretty(psPath, ps);
  }
  const dazPath = path4.join(projectDir, "config", "deploy-azure-storage.json");
  const daz = await readJsonIfExists(dazPath);
  if (daz && opts.rename && typeof daz.container === "string") {
    daz.container = opts.rename;
    await writeJsonPretty(dazPath, daz);
  }
  const readmePath = path4.join(projectDir, "README.md");
  if (opts.rename && oldName) {
    try {
      const existing = await fs2.readFile(readmePath, "utf8");
      const updated = existing.replace(new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), opts.rename);
      if (updated !== existing) {
        await fs2.writeFile(readmePath, updated, "utf8");
      }
    } catch {
    }
  }
}
async function postProcessProject(projectPath, options, spinner) {
  const rename = options.rename?.trim();
  let newId;
  if (options.newid) {
    if (typeof options.newid === "string") {
      const v = options.newid.trim();
      if (!isGuid(v)) {
        throw new Error(`--newid must be a GUID (or omit the value to auto-generate one). Received: ${v}`);
      }
      newId = v;
    } else {
      newId = randomUUID();
    }
  }
  if (rename || newId) {
    spinner && (spinner.text = `Updating project metadata${rename ? ` (rename \u2192 ${rename})` : ""}${newId ? " (new id)" : ""}\u2026`);
    await renameSpfxProject(projectPath, { rename, newId });
  }
}
var program = new Command();
program.name("spfx-sample").description("Fetch a single sample folder from a large GitHub repo using git sparse-checkout (no full clone).").version("0.3.0", "-v, --version", "output the current version");
var envNoColor = typeof process.env.NO_COLOR !== "undefined";
program.command("get").argument("<sample>", "Sample folder name, e.g. react-hello-world OR samples/react-hello-world").option("--owner <owner>", "GitHub org/user", DEFAULT_OWNER).option("--repo <repo>", "GitHub repository name", DEFAULT_REPO).option("--ref <ref>", "Git ref (branch, tag, or commit SHA)", DEFAULT_REF).option("--dest <dest>", "Destination folder (default varies by --mode)").option("--rename <newName>", "Rename the downloaded SPFx project (package.json/.yo-rc.json/package-solution.json/README)").option("--newid [id]", "Generate or set a new SPFx solution id (GUID). If omitted value, a new GUID is generated.").option("--mode <mode>", 'Mode: "extract" (copy sample out) or "repo" (leave sparse repo)', "extract").option("--method <method>", 'Method: "auto" (git if available, else api), "git", or "api"', "auto").option("--force", "Overwrite destination if it exists", false).option("--verbose", "Print git output", false).option("--no-color", "Disable ANSI colors", false).action(async (sample, options) => {
  if (envNoColor || options.noColor) {
    try {
      chalk.level = 0;
    } catch {
    }
  }
  const sampleFolder = normalizeSampleArg(sample);
  const ref = options.ref || DEFAULT_REF;
  const repo = options.repo || DEFAULT_REPO;
  const owner = options.owner || DEFAULT_OWNER;
  const verbose = !!options.verbose;
  let mode;
  try {
    mode = assertMode(options.mode);
  } catch (e) {
    console.error(chalk.red(e.message));
    process.exitCode = 1;
    return;
  }
  let method;
  try {
    method = assertMethod(options.method);
  } catch (e) {
    console.error(chalk.red(e.message));
    process.exitCode = 1;
    return;
  }
  const defaultDest = mode === "extract" ? `./${sampleFolder}` : `./${repo}-${sampleFolder}`.replaceAll("/", "-");
  const impliedDest = options.dest ? void 0 : options.rename ? `./${options.rename}` : void 0;
  const destDir = path4.resolve(options.dest ?? impliedDest ?? defaultDest);
  const gitAvailable = await isGitAvailable(verbose);
  const chosen = method === "auto" ? gitAvailable ? "git" : "api" : method;
  if (verbose) console.error(`[debug] method=${method} gitAvailable=${gitAvailable} chosen=${chosen}`);
  if (chosen === "git") {
    try {
      await ensureGit(verbose);
    } catch (e) {
      console.error(chalk.red(e.message));
      process.exitCode = 1;
      return;
    }
  }
  if (chosen === "api" && mode === "repo") {
    console.error(chalk.red(`--mode repo requires --method git (API method cannot create a git working repo).`));
    process.exitCode = 1;
    return;
  }
  if (await pathExists(destDir)) {
    if (!options.force) {
      const nonEmpty = await isDirNonEmpty(destDir);
      if (nonEmpty) {
        console.error(
          chalk.red(`\u{1F6D1} Destination folder is not empty: ${destDir}
`) + chalk.yellow(`Use --force to overwrite (or specify a different destination with --dest).`)
        );
        process.exitCode = 1;
        return;
      }
    } else {
      try {
        await fs2.rm(destDir, { recursive: true, force: true });
      } catch (e) {
        if (e && (e.code === "EBUSY" || e.code === "EPERM")) {
          console.error(chalk.red(`\u{1F6D1} Destination folder is in use or locked: ${destDir}`));
          console.error(chalk.yellow(`Close any programs (VS Code, terminals) using the folder and try again.`));
          process.exitCode = 1;
          return;
        }
        throw e;
      }
    }
  }
  const spinner = ora(`Getting sample ${sampleFolder} from ${owner}/${repo}@${ref}\u2026`).start();
  spinner.text = `Preparing to fetch (method=${chosen})\u2026`;
  const controllers = [];
  const topController = new AbortController();
  controllers.push(topController);
  const onSigint = () => {
    spinner && spinner.fail("Aborted by user.");
    for (const c of controllers) c.abort();
    process.exit(130);
  };
  process.once("SIGINT", onSigint);
  try {
    if (chosen === "api") {
      spinner.text = `Downloading files via GitHub API\u2026`;
      await fs2.mkdir(destDir, { recursive: true });
      let bar = null;
      let lastRendered = Date.now();
      const controller = new AbortController();
      controllers.push(controller);
      await downloadSampleViaGitHubSubtree({
        owner,
        repo,
        ref,
        sampleFolder,
        destDir,
        concurrency: 8,
        verbose,
        signal: controller.signal,
        onProgress: (done, total, filePath) => {
          if (!bar) {
            try {
              bar = new ProgressBar("[:bar] :percent :current/:total :file", {
                total,
                width: 30,
                renderThrottle: 100
              });
            } catch {
              bar = null;
            }
          }
          if (bar) {
            const delta = done - (bar.curr || 0);
            if (delta > 0) bar.tick(delta, { file: path4.basename(filePath) });
          } else {
            const now = Date.now();
            if (now - lastRendered > 150) {
              spinner.text = `Downloading (${done}/${total})\u2026 ${filePath}`;
              lastRendered = now;
            }
          }
        }
      });
      spinner.text = `Post-processing project files\u2026`;
      await postProcessProject(destDir, options, spinner);
      await finalizeExtraction({
        spinner,
        successMessage: `Done! Downloaded ${chalk.cyan(`samples/${sampleFolder}`)} into ${chalk.green(destDir)}`,
        projectPath: destDir
      });
      return;
    }
    if (mode === "extract") {
      spinner.text = `Performing sparse git extract\u2026`;
      await fetchSampleViaSparseGitExtract({
        owner,
        repo,
        ref,
        sampleFolder,
        destDir,
        verbose,
        spinner,
        signal: topController.signal
      });
      spinner.text = `Post-processing project files\u2026`;
      await postProcessProject(destDir, options, spinner);
      await finalizeExtraction({
        spinner,
        successMessage: `Done! Extracted ${chalk.cyan(`samples/${sampleFolder}`)} into ${chalk.green(destDir)}`,
        projectPath: destDir
      });
    } else {
      await fs2.mkdir(destDir, { recursive: true });
      spinner.text = `Performing sparse git clone (repo mode)\u2026`;
      await sparseCloneInto({
        owner,
        repo,
        ref,
        sampleFolder,
        repoDir: destDir,
        verbose,
        spinner,
        signal: topController.signal
      });
      const samplePath = path4.join(destDir, "samples", sampleFolder);
      await postProcessProject(samplePath, options, spinner);
      await finalizeExtraction({
        spinner,
        successMessage: `Done! Sparse repo ready at ${chalk.green(destDir)} (sample at ${chalk.cyan(samplePath)})`,
        projectPath: samplePath,
        repoRoot: destDir
      });
    }
  } catch (err) {
    spinner.fail(err.message);
    process.exitCode = 1;
  }
});
async function getCommandHandler(sample, options, deps) {
  const sampleFolder = normalizeSampleArg(sample);
  const ref = options.ref || DEFAULT_REF;
  const repo = options.repo || DEFAULT_REPO;
  const owner = options.owner || DEFAULT_OWNER;
  const verbose = !!options.verbose;
  const download = deps?.download ?? downloadSampleViaGitHubSubtree;
  const fetchSparse = deps?.fetchSparse ?? fetchSampleViaSparseGitExtract;
  const sparseClone = deps?.sparseClone ?? sparseCloneInto;
  const postProcess = deps?.postProcess ?? postProcessProject;
  const finalize = deps?.finalize ?? finalizeExtraction;
  const gitAvailableFn = deps?.isGitAvailable ?? isGitAvailable;
  const ensureGitFn = deps?.ensureGit ?? ensureGit;
  let mode;
  try {
    mode = assertMode(options.mode);
  } catch (e) {
    throw e;
  }
  let method;
  try {
    method = assertMethod(options.method);
  } catch (e) {
    throw e;
  }
  const defaultDest = mode === "extract" ? `./${sampleFolder}` : `./${repo}-${sampleFolder}`.replaceAll("/", "-");
  const impliedDest = options.dest ? void 0 : options.rename ? `./${options.rename}` : void 0;
  const destDir = path4.resolve(options.dest ?? impliedDest ?? defaultDest);
  const gitAvailable = await gitAvailableFn(verbose);
  const chosen = method === "auto" ? gitAvailable ? "git" : "api" : method;
  if (chosen === "git") {
    await ensureGitFn(verbose);
  }
  if (chosen === "api" && mode === "repo") {
    throw new Error(`--mode repo requires --method git (API method cannot create a git working repo).`);
  }
  if (await pathExists(destDir)) {
    if (!options.force) {
      const nonEmpty = await isDirNonEmpty(destDir);
      if (nonEmpty) throw new Error(`Destination exists and is not empty: ${destDir}`);
    } else {
      try {
        await fs2.rm(destDir, { recursive: true, force: true });
      } catch (e) {
        if (e && (e.code === "EBUSY" || e.code === "EPERM")) {
          throw new Error(`Destination folder is in use or locked: ${destDir}`);
        }
        throw e;
      }
    }
  }
  if (chosen === "api") {
    await fs2.mkdir(destDir, { recursive: true });
    await download({ owner, repo, ref, sampleFolder, destDir, concurrency: 8, verbose, signal: void 0, onProgress: void 0 });
    await postProcess(destDir, options, void 0);
    await finalize({ spinner: void 0, successMessage: `Done`, projectPath: destDir });
    return;
  }
  if (chosen === "git") {
    if (mode === "extract") {
      await fetchSparse({ owner, repo, ref, sampleFolder, destDir, verbose, spinner: void 0, signal: void 0 });
      await postProcess(destDir, options, void 0);
      await finalize({ spinner: void 0, successMessage: `Done`, projectPath: destDir });
      return;
    } else {
      await fs2.mkdir(destDir, { recursive: true });
      await sparseClone({ owner, repo, ref, sampleFolder, repoDir: destDir, verbose, spinner: void 0, signal: void 0 });
      const samplePath = path4.join(destDir, "samples", sampleFolder);
      await postProcess(samplePath, options, void 0);
      await finalize({ spinner: void 0, successMessage: `Done`, projectPath: samplePath, repoRoot: destDir });
      return;
    }
  }
}
program.command("rename").argument("<path>", "Path to previously downloaded sample folder (project root)").option("--newname <newName>", "Rename the SPFx project (package.json/.yo-rc.json/package-solution.json/README)").option("--newid [id]", "Generate or set a new SPFx solution id (GUID). If omitted value, a new GUID is generated.").option("--verbose", "Print debug output", false).option("--no-color", "Disable ANSI colors", false).action(async (p, options) => {
  if (envNoColor || options.noColor) {
    try {
      chalk.level = 0;
    } catch {
    }
  }
  const projectPath = path4.resolve(p);
  if (!await pathExists(projectPath)) {
    console.error(chalk.red(`Path not found: ${projectPath}`));
    process.exitCode = 1;
    return;
  }
  const opts = { rename: options.newname, newid: typeof options.newid === "string" ? options.newid : options.newid ? true : void 0 };
  const spinner = ora(`Renaming project at ${projectPath}\u2026`).start();
  try {
    await postProcessProject(projectPath, opts, spinner);
    spinner.succeed(`Updated project at ${projectPath}`);
  } catch (err) {
    spinner.fail(err.message);
    process.exitCode = 1;
  }
});
if (process.env.NODE_ENV !== "test") {
  program.parse(process.argv);
}
export {
  assertMethod,
  assertMode,
  fetchJsonUrl,
  getCommandHandler,
  getSpfxMatrix,
  isGuid,
  maybePrintNvmrcAdvice,
  normalizeSampleArg,
  parseGitVersion,
  postProcessProject,
  renameSpfxProject,
  versionGte
};
//# sourceMappingURL=cli.js.map