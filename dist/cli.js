#!/usr/bin/env node

// src/cli.ts
import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import path3 from "path";
import os2 from "os";
import fs2 from "fs/promises";
import { spawn } from "child_process";

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
async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "@pnp/spfx-sample" } });
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
async function fetchTree(owner, repo, treeish, recursive = false) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(treeish)}${recursive ? "?recursive=1" : ""}`;
  return fetchJson(url);
}
async function ensureDirForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}
async function downloadSampleViaGitHubSubtree(opts) {
  const { owner, repo, ref, sampleFolder, destDir } = opts;
  const concurrency = opts.concurrency ?? 8;
  const root = await fetchTree(owner, repo, ref, false);
  if (root.message) throw new Error(root.message);
  const samplesTree = root.tree.find((t) => t.type === "tree" && t.path === "samples");
  if (!samplesTree) throw new Error(`Could not find /samples at ${owner}/${repo}@${ref}`);
  const samples = await fetchTree(owner, repo, samplesTree.sha, false);
  const sampleTree = samples.tree.find((t) => t.type === "tree" && t.path === sampleFolder);
  if (!sampleTree) throw new Error(`Sample folder not found: samples/${sampleFolder} at ${ref}`);
  const sample = await fetchTree(owner, repo, sampleTree.sha, true);
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
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${fullRepoPath}`;
        const res = await fetch(rawUrl);
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

// src/cli.ts
var DEFAULT_OWNER = "pnp";
var DEFAULT_REPO = "sp-dev-fx-webparts";
var DEFAULT_REF = "main";
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
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
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
    const s = path3.join(src, e.name);
    const d = path3.join(dest, e.name);
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
    { verbose }
  );
  spinner && (spinner.text = `Enabling sparse checkout\u2026`);
  await run("git", ["-C", repoDir, "sparse-checkout", "init", "--cone"], { verbose });
  spinner && (spinner.text = `Selecting ${sparsePath}\u2026`);
  await run("git", ["-C", repoDir, "sparse-checkout", "set", sparsePath], { verbose });
  spinner && (spinner.text = `Fetching ref ${ref}\u2026`);
  await run("git", ["-C", repoDir, "fetch", "--depth=1", "--filter=blob:none", "origin", ref], {
    verbose
  });
  spinner && (spinner.text = `Checking out ${ref}\u2026`);
  await run("git", ["-C", repoDir, "checkout", "--detach", "FETCH_HEAD"], { verbose });
  const srcSampleDir = path3.join(repoDir, "samples", sampleFolder);
  if (!await pathExists(srcSampleDir) || !await isDirNonEmpty(srcSampleDir)) {
    throw new Error(`Sample not found or empty: ${owner}/${repo}@${ref} \u2192 samples/${sampleFolder}`);
  }
}
async function fetchSampleViaSparseGitExtract(args) {
  const { owner, repo, ref, sampleFolder, destDir, verbose, spinner } = args;
  const tmpRoot = await fs2.mkdtemp(path3.join(os2.tmpdir(), "spfx-sample-"));
  const tmpRepoDir = path3.join(tmpRoot, "repo");
  try {
    await sparseCloneInto({ owner, repo, ref, sampleFolder, repoDir: tmpRepoDir, verbose, spinner });
    const srcSampleDir = path3.join(tmpRepoDir, "samples", sampleFolder);
    spinner && (spinner.text = `Copying sample to ${destDir}\u2026`);
    await copyDir(srcSampleDir, destDir);
  } finally {
    await fs2.rm(tmpRoot, { recursive: true, force: true }).catch(() => void 0);
  }
}
async function readNvmrc(root) {
  const p = path3.join(root, ".nvmrc");
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
function nodeVersionGte(a, b) {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch >= b.patch;
}
function getCurrentNodeVersion() {
  const v = process.version.replace(/^v/, "");
  const parts = v.split(".").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}
async function maybePrintNvmrcAdvice(sampleRoot) {
  const nvmrc = await readNvmrc(sampleRoot);
  if (!nvmrc) return;
  const required = parseNodeVersion(nvmrc);
  const current = getCurrentNodeVersion();
  if (!required || !current) return;
  if (!nodeVersionGte(current, required)) {
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
}
function assertMode(m) {
  if (!m) return "extract";
  if (m === "extract" || m === "repo") return m;
  throw new Error(`Invalid --mode "${m}". Use "extract" or "repo".`);
}
var program = new Command();
program.name("spfx-sample").description("Fetch a single sample folder from a large GitHub repo using git sparse-checkout (no full clone).").version("0.3.0");
program.command("get").argument("<sample>", "Sample folder name, e.g. react-hello-world OR samples/react-hello-world").option("--owner <owner>", "GitHub org/user", DEFAULT_OWNER).option("--repo <repo>", "GitHub repository name", DEFAULT_REPO).option("--ref <ref>", "Git ref (branch, tag, or commit SHA)", DEFAULT_REF).option("--dest <dest>", "Destination folder (default varies by --mode)").option("--mode <mode>", 'Mode: "extract" (copy sample out) or "repo" (leave sparse repo)', "extract").option("--method <method>", 'Method: "auto" (git if available, else api), "git", or "api"', "auto").option("--force", "Overwrite destination if it exists", false).option("--verbose", "Print git output", false).action(async (sample, options) => {
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
  const destDir = path3.resolve(options.dest ?? defaultDest);
  const gitAvailable = await isGitAvailable(verbose);
  const chosen = method === "auto" ? gitAvailable ? "git" : "api" : method;
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
          chalk.red(`Destination exists and is not empty: ${destDir}
`) + chalk.yellow(`Use --force to overwrite (or choose --dest).`)
        );
        process.exitCode = 1;
        return;
      }
    } else {
      await fs2.rm(destDir, { recursive: true, force: true });
    }
  }
  const spinner = ora(`Getting sample ${sampleFolder} from ${owner}/${repo}@${ref}\u2026`).start();
  try {
    if (chosen === "api") {
      await fs2.mkdir(destDir, { recursive: true });
      await downloadSampleViaGitHubSubtree({
        owner,
        repo,
        ref,
        sampleFolder,
        destDir,
        concurrency: 8,
        onProgress: (done, total, filePath) => {
          spinner.text = `Downloading (${done}/${total})\u2026 ${filePath}`;
        }
      });
      spinner.succeed(
        `Done! Downloaded ${chalk.cyan(`samples/${sampleFolder}`)} into ${chalk.green(destDir)}`
      );
      console.log();
      console.log(chalk.green("Next steps:"));
      console.log(`  ${chalk.yellow("cd")} ${chalk.blue(`"${destDir}"`)}`);
      await maybePrintNvmrcAdvice(destDir);
      console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("i")}`));
      console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("run build")}`));
      console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("run serve")}`));
      return;
    }
    if (mode === "extract") {
      await fetchSampleViaSparseGitExtract({
        owner,
        repo,
        ref,
        sampleFolder,
        destDir,
        verbose,
        spinner
      });
      spinner.succeed(
        `Done! Extracted ${chalk.cyan(`samples/${sampleFolder}`)} into ${chalk.green(destDir)}`
      );
      console.log();
      console.log(chalk.green("Next steps:"));
      console.log(`  ${chalk.yellow("cd")} ${chalk.blue(`"${destDir}"`)}`);
      await maybePrintNvmrcAdvice(destDir);
      console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("i")}`));
      console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("run build")}`));
      console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("run serve")}`));
    } else {
      await fs2.mkdir(destDir, { recursive: true });
      await sparseCloneInto({
        owner,
        repo,
        ref,
        sampleFolder,
        repoDir: destDir,
        verbose,
        spinner
      });
      const samplePath = path3.join(destDir, "samples", sampleFolder);
      spinner.succeed(
        `Done! Sparse repo ready at ${chalk.green(destDir)} (sample at ${chalk.cyan(samplePath)})`
      );
      console.log();
      console.log(`  ${chalk.yellow("cd")} ${chalk.blue(`"${samplePath}"`)}`);
      await maybePrintNvmrcAdvice(samplePath);
      console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("i")}`));
      console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("run build")}`));
      console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("run serve")}`));
      console.log();
      console.log(chalk.green("Contribute back:"));
      console.log(`  ${chalk.yellow("cd")} ${chalk.blue(`"${destDir}"`)}`);
      console.log(chalk.white(`  ${chalk.yellow("git")} ${chalk.white("status")}`));
      console.log(chalk.white(`  ${chalk.yellow("git")} ${chalk.white("checkout")} ${chalk.gray("-b")} ${chalk.white("my-change")}`));
    }
  } catch (err) {
    spinner.fail(err.message);
    process.exitCode = 1;
  }
});
program.parse(process.argv);
//# sourceMappingURL=cli.js.map