#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/cli.ts
var import_commander = require("commander");
var import_ora = __toESM(require("ora"));
var import_chalk = __toESM(require("chalk"));
var import_node_path2 = __toESM(require("path"));
var import_node_os = __toESM(require("os"));
var import_promises2 = __toESM(require("fs/promises"));
var import_node_child_process = require("child_process");

// src/githubPartialSubtree.ts
var import_node_path = __toESM(require("path"));
var import_promises = __toESM(require("fs/promises"));
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
  await import_promises.default.mkdir(import_node_path.default.dirname(filePath), { recursive: true });
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
  await import_promises.default.mkdir(destDir, { recursive: true });
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
        const outPath = import_node_path.default.join(destDir, rel);
        await ensureDirForFile(outPath);
        await import_promises.default.writeFile(outPath, bytes);
        done++;
        opts.onProgress?.(done, blobs.length, fullRepoPath);
      })
    )
  );
}

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
    await import_promises2.default.access(p);
    return true;
  } catch {
    return false;
  }
}
async function isDirNonEmpty(p) {
  try {
    const entries = await import_promises2.default.readdir(p);
    return entries.length > 0;
  } catch {
    return false;
  }
}
async function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = (0, import_node_child_process.spawn)(cmd, args, {
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
  await import_promises2.default.mkdir(dest, { recursive: true });
  const fsp = import_promises2.default;
  if (typeof fsp.cp === "function") {
    await fsp.cp(src, dest, { recursive: true });
    return;
  }
  const entries = await import_promises2.default.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = import_node_path2.default.join(src, e.name);
    const d = import_node_path2.default.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await import_promises2.default.copyFile(s, d);
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
  const srcSampleDir = import_node_path2.default.join(repoDir, "samples", sampleFolder);
  if (!await pathExists(srcSampleDir) || !await isDirNonEmpty(srcSampleDir)) {
    throw new Error(`Sample not found or empty: ${owner}/${repo}@${ref} \u2192 samples/${sampleFolder}`);
  }
}
async function fetchSampleViaSparseGitExtract(args) {
  const { owner, repo, ref, sampleFolder, destDir, verbose, spinner } = args;
  const tmpRoot = await import_promises2.default.mkdtemp(import_node_path2.default.join(import_node_os.default.tmpdir(), "spfx-sample-"));
  const tmpRepoDir = import_node_path2.default.join(tmpRoot, "repo");
  try {
    await sparseCloneInto({ owner, repo, ref, sampleFolder, repoDir: tmpRepoDir, verbose, spinner });
    const srcSampleDir = import_node_path2.default.join(tmpRepoDir, "samples", sampleFolder);
    spinner && (spinner.text = `Copying sample to ${destDir}\u2026`);
    await copyDir(srcSampleDir, destDir);
  } finally {
    await import_promises2.default.rm(tmpRoot, { recursive: true, force: true }).catch(() => void 0);
  }
}
function assertMode(m) {
  if (!m) return "extract";
  if (m === "extract" || m === "repo") return m;
  throw new Error(`Invalid --mode "${m}". Use "extract" or "repo".`);
}
var program = new import_commander.Command();
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
    console.error(import_chalk.default.red(e.message));
    process.exitCode = 1;
    return;
  }
  let method;
  try {
    method = assertMethod(options.method);
  } catch (e) {
    console.error(import_chalk.default.red(e.message));
    process.exitCode = 1;
    return;
  }
  const defaultDest = mode === "extract" ? `./${sampleFolder}` : `./${repo}-${sampleFolder}`.replaceAll("/", "-");
  const destDir = import_node_path2.default.resolve(options.dest ?? defaultDest);
  const gitAvailable = await isGitAvailable(verbose);
  const chosen = method === "auto" ? gitAvailable ? "git" : "api" : method;
  if (chosen === "git") {
    try {
      await ensureGit(verbose);
    } catch (e) {
      console.error(import_chalk.default.red(e.message));
      process.exitCode = 1;
      return;
    }
  }
  if (chosen === "api" && mode === "repo") {
    console.error(import_chalk.default.red(`--mode repo requires --method git (API method cannot create a git working repo).`));
    process.exitCode = 1;
    return;
  }
  if (await pathExists(destDir)) {
    if (!options.force) {
      const nonEmpty = await isDirNonEmpty(destDir);
      if (nonEmpty) {
        console.error(
          import_chalk.default.red(`Destination exists and is not empty: ${destDir}
`) + import_chalk.default.yellow(`Use --force to overwrite (or choose --dest).`)
        );
        process.exitCode = 1;
        return;
      }
    } else {
      await import_promises2.default.rm(destDir, { recursive: true, force: true });
    }
  }
  const spinner = (0, import_ora.default)(`Getting sample ${sampleFolder} from ${owner}/${repo}@${ref}\u2026`).start();
  try {
    if (chosen === "api") {
      await import_promises2.default.mkdir(destDir, { recursive: true });
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
        `Done! Downloaded ${import_chalk.default.cyan(`samples/${sampleFolder}`)} into ${import_chalk.default.green(destDir)}`
      );
      console.log();
      console.log(import_chalk.default.green("Next steps:"));
      console.log(import_chalk.default.yellow(`  cd "${destDir}"`));
      console.log(import_chalk.default.yellow("  npm i"));
      console.log(import_chalk.default.yellow("  npm run build"));
      console.log(import_chalk.default.yellow("  npm run serve"));
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
        `Done! Extracted ${import_chalk.default.cyan(`samples/${sampleFolder}`)} into ${import_chalk.default.green(destDir)}`
      );
      console.log();
      console.log(import_chalk.default.green("Next steps:"));
      console.log(import_chalk.default.yellow(`  cd "${destDir}"`));
      console.log(import_chalk.default.yellow("  npm i"));
      console.log(import_chalk.default.yellow("  npm run build"));
      console.log(import_chalk.default.yellow("  npm run serve"));
    } else {
      await import_promises2.default.mkdir(destDir, { recursive: true });
      await sparseCloneInto({
        owner,
        repo,
        ref,
        sampleFolder,
        repoDir: destDir,
        verbose,
        spinner
      });
      const samplePath = import_node_path2.default.join(destDir, "samples", sampleFolder);
      spinner.succeed(
        `Done! Sparse repo ready at ${import_chalk.default.green(destDir)} (sample at ${import_chalk.default.cyan(samplePath)})`
      );
      console.log();
      console.log(import_chalk.default.green("Next steps:"));
      console.log(import_chalk.default.yellow(`  cd "${samplePath}"`));
      console.log(import_chalk.default.yellow("  npm i"));
      console.log(import_chalk.default.yellow("  npm run build"));
      console.log(import_chalk.default.yellow("  npm run serve"));
      console.log();
      console.log(import_chalk.default.green("Contribute back:"));
      console.log(import_chalk.default.yellow(`  cd "${destDir}"`));
      console.log(import_chalk.default.yellow("  git status"));
      console.log(import_chalk.default.yellow("  git checkout -b my-change"));
    }
  } catch (err) {
    spinner.fail(err.message);
    process.exitCode = 1;
  }
});
program.parse(process.argv);
//# sourceMappingURL=cli.js.map