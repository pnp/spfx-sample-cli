#!/usr/bin/env node
/* eslint-disable no-console */
import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { downloadSampleViaGitHubSubtree } from "./githubPartialSubtree";
import ProgressBar from "progress";
import detectVersionManagers from "./detectVersionManagers";
import detectServeCommand from "./detectServeCommand";
import type { CliOptions, Mode, Method } from "./cliOptions";


const DEFAULT_OWNER = "pnp";
const DEFAULT_REPO = "sp-dev-fx-webparts";
const DEFAULT_REF = "main";

// Global handlers to ensure process exits with non-zero code on unexpected errors
process.on("unhandledRejection", (reason) => {
    console.error("Unhandled Promise rejection:", reason);
    process.exitCode = 1;
});

process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", (err as Error).message || err);
    process.exitCode = 1;
    // give other handlers a chance then exit
    setImmediate(() => process.exit(1));
});

function normalizeSampleArg(sample: string): string {
    // Allow either "react-my-sample" OR "samples/react-my-sample"
    const s = sample.replaceAll("\\", "/").trim();
    if (s.startsWith("samples/")) return s.slice("samples/".length);
    return s;
}
export { normalizeSampleArg };

async function pathExists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

async function isDirNonEmpty(p: string): Promise<boolean> {
    try {
        const entries = await fs.readdir(p);
        return entries.length > 0;
    } catch {
        return false;
    }
}

type RunResult = { stdout: string; stderr: string };

async function run(
    cmd: string,
    args: string[],
    opts: { cwd?: string; verbose?: boolean; signal?: AbortSignal } = {}
): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        if (opts.verbose) console.error(`[debug] spawn: ${cmd} ${args.join(" ")} cwd=${opts.cwd ?? process.cwd()}`);
        const child = spawn(cmd, args, {
            cwd: opts.cwd,
            shell: false,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        });

        // If an AbortSignal is provided, try to kill the child when aborted
        if (opts.signal) {
            if (opts.signal.aborted) {
                child.kill();
            } else {
                const onAbort = () => {
                    try { child.kill(); } catch {}
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
            else reject(new Error(`${cmd} ${args.join(" ")} failed (exit ${code}).\n${stderr || stdout}`));
        });
    });
}

function parseGitVersion(output: string): { major: number; minor: number; patch: number } | null {
    const m = output.match(/git version (\d+)\.(\d+)\.(\d+)/i);
    if (!m) return null;
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}
export { parseGitVersion };

function versionGte(
    v: { major: number; minor: number; patch: number },
    min: { major: number; minor: number; patch: number }
): boolean {
    if (v.major !== min.major) return v.major > min.major;
    if (v.minor !== min.minor) return v.minor > min.minor;
    return v.patch >= min.patch;
}
export { versionGte };

async function ensureGit(verbose?: boolean): Promise<void> {
    let res: RunResult;
    try {
        res = await run("git", ["--version"], { verbose });
    } catch {
        throw new Error(
            "Git was not found on PATH. Install Git for Windows (or your platform) and try again."
        );
    }

    const v = parseGitVersion(res.stdout.trim());
    if (!v) return;

    // sparse-checkout cone mode: Git >= 2.25
    const min = { major: 2, minor: 25, patch: 0 };
    if (!versionGte(v, min)) {
        throw new Error(
            `Git ${v.major}.${v.minor}.${v.patch} is too old. Please upgrade to >= 2.25 for sparse-checkout cone mode.`
        );
    }
}

async function isGitAvailable(verbose?: boolean): Promise<boolean> {
    try {
        await run("git", ["--version"], { verbose });
        return true;
    } catch {
        return false;
    }
}

function assertMethod(m: string | undefined): Method {
    if (!m) return "auto";
    if (m === "auto" || m === "git" || m === "api") return m;
    throw new Error(`Invalid --method "${m}". Use "auto", "git", or "api".`);
}
export { assertMethod };

async function copyDir(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    // Node 18+ supports fs.cp
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fsp: any = fs;
    if (typeof fsp.cp === "function") {
        await fsp.cp(src, dest, { recursive: true });
        return;
    }

    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const e of entries) {
        const s = path.join(src, e.name);
        const d = path.join(dest, e.name);
        if (e.isDirectory()) await copyDir(s, d);
        else await fs.copyFile(s, d);
    }
}

/**
 * Perform a sparse+partial clone and checkout of the requested ref, keeping only `samples/<sampleFolder>` in the working tree.
 *
 * If `repoDir` is temp: you can copy the sample out after.
 * If `repoDir` is final destination: leave it there for contributor workflow.
 */
async function sparseCloneInto(args: {
    owner: string;
    repo: string;
    ref: string;
    sampleFolder: string;
    repoDir: string;
    verbose?: boolean;
    spinner?: ReturnType<typeof ora>;
    signal?: AbortSignal;
}): Promise<void> {
    const { owner, repo, ref, sampleFolder, repoDir, verbose, spinner } = args;

    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    const sparsePath = `samples/${sampleFolder}`.replaceAll("\\", "/");

    spinner && (spinner.text = `Cloning (partial) ${owner}/${repo}…`);
    await run(
        "git",
        ["clone", "--depth=1", "--filter=blob:none", "--no-checkout", repoUrl, repoDir],
        { verbose, signal: args.signal }
    );

    spinner && (spinner.text = `Enabling sparse checkout…`);
    await run("git", ["-C", repoDir, "sparse-checkout", "init", "--cone"], { verbose, signal: args.signal });

    spinner && (spinner.text = `Selecting ${sparsePath}…`);
    await run("git", ["-C", repoDir, "sparse-checkout", "set", sparsePath], { verbose, signal: args.signal });

    spinner && (spinner.text = `Switching to ${ref} branch…`);
    await run("git", ["-C", repoDir, "fetch", "--depth=1", "--filter=blob:none", "origin", ref], {
        verbose,
        signal: args.signal
    });

    spinner && (spinner.text = `Getting sample from ${ref} branch…`);
    await run("git", ["-C", repoDir, "checkout", "--detach", "FETCH_HEAD"], { verbose, signal: args.signal });

    const srcSampleDir = path.join(repoDir, "samples", sampleFolder);
    if (!(await pathExists(srcSampleDir)) || !(await isDirNonEmpty(srcSampleDir))) {
        throw new Error(`Sample not found or empty: ${owner}/${repo}@${ref} → samples/${sampleFolder}`);
    }
}

async function fetchSampleViaSparseGitExtract(args: {
    owner: string;
    repo: string;
    ref: string;
    sampleFolder: string; // e.g. "react-hello-world"
    destDir: string; // final output directory (sample root)
    verbose?: boolean;
    spinner?: ReturnType<typeof ora>;
    signal?: AbortSignal;
}): Promise<void> {
    const { owner, repo, ref, sampleFolder, destDir, verbose, spinner } = args;

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spfx-sample-"));
    const tmpRepoDir = path.join(tmpRoot, "repo");

    try {
        await sparseCloneInto({ owner, repo, ref, sampleFolder, repoDir: tmpRepoDir, verbose, spinner, signal: args.signal });

        const srcSampleDir = path.join(tmpRepoDir, "samples", sampleFolder);

        spinner && (spinner.text = `Copying sample to ${destDir}…`);
        await copyDir(srcSampleDir, destDir);
    } finally {
        await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
    }
}

async function readNvmrc(root: string): Promise<string | null> {
    const p = path.join(root, '.nvmrc');
    try {
        const txt = await fs.readFile(p, 'utf8');
        const v = txt.split(/\r?\n/)[0].trim();
        return v || null;
    } catch {
        return null;
    }
}

function parseNodeVersion(v: string | null): { major: number; minor: number; patch: number } | null {
    if (!v) return null;
    // Allow forms like: 14, 14.17, 14.17.0, v14.17.0
    const s = v.trim().replace(/^v/, '');
    const parts = s.split('.').map((p) => Number(p || 0));
    if (parts.some((n) => Number.isNaN(n))) return null;
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
}

function nodeVersionGte(a: { major: number; minor: number; patch: number }, b: { major: number; minor: number; patch: number }): boolean {
    if (a.major !== b.major) return a.major > b.major;
    if (a.minor !== b.minor) return a.minor > b.minor;
    return a.patch >= b.patch;
}

function getCurrentNodeVersion(): { major: number; minor: number; patch: number } | null {
    const v = process.version.replace(/^v/, '');
    const parts = v.split('.').map((p) => Number(p));
    if (parts.some((n) => Number.isNaN(n))) return null;
    return { major: parts[0], minor: parts[1], patch: parts[2] };
}

async function maybePrintNvmrcAdvice(sampleRoot: string): Promise<void> {
    const nvmrc = await readNvmrc(sampleRoot);
    if (!nvmrc) return;

    const required = parseNodeVersion(nvmrc);
    const current = getCurrentNodeVersion();


    if (!required || !current) return;

    if (!nodeVersionGte(current, required)) {
        console.log();
        console.log(chalk.yellow(`This sample suggests Node ${nvmrc} (from .nvmrc).`));
        console.log(chalk.yellow(`Your current Node is ${process.version}.`));
  

        // Helpful hint: detect common node version managers
        try {
            const dm = await detectVersionManagers();
            const choices: string[] = [];
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
            // ignore detection failures
        }
    }
}

type FinalizeArgs = {
    spinner?: ReturnType<typeof ora>;
    successMessage: string;
    projectPath: string; // directory where to run npm i / build / serve
    repoRoot?: string; // when repo mode: top-level repo dir to show contribute back
};

async function finalizeExtraction(opts: FinalizeArgs): Promise<void> {
    const { spinner, successMessage, projectPath, repoRoot } = opts;

    spinner && spinner.succeed(successMessage);

    // Place for additional post-extract logic (user requested hook)
    // e.g. customize project files, run transforms, etc.

    console.log();
    console.log(chalk.green("Next steps:"));
    console.log(`  ${chalk.yellow("cd")} ${chalk.blue(`"${projectPath}"`)} `);
    await maybePrintNvmrcAdvice(projectPath);
    console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("i")}`));
    console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("run build")}`));
    try {
        const serve = await detectServeCommand(projectPath);
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

function assertMode(m: string | undefined): Mode {
    if (!m) return "extract";
    if (m === "extract" || m === "repo") return m;
    throw new Error(`Invalid --mode "${m}". Use "extract" or "repo".`);
}
export { assertMode };

function isGuid(v: string): boolean {
    // Accepts RFC4122-ish GUIDs (case-insensitive)
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}
export { isGuid };

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
    try {
        const txt = await fs.readFile(filePath, "utf8");
        return JSON.parse(txt) as T;
    } catch {
        return null;
    }
}

async function writeJsonPretty(filePath: string, obj: unknown): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

export async function renameSpfxProject(projectDir: string, opts: { rename?: string; newId?: string }): Promise<void> {
    const pkgPath = path.join(projectDir, "package.json");
    const pkg = await readJsonIfExists<any>(pkgPath);
    const oldName: string | undefined = pkg?.name;

    // package.json name
    if (pkg && opts.rename) {
        pkg.name = opts.rename;
        await writeJsonPretty(pkgPath, pkg);
    }

    // .yo-rc.json: libraryName, solutionName, libraryId
    const yoPath = path.join(projectDir, ".yo-rc.json");
    const yo = await readJsonIfExists<any>(yoPath);
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

    // config/package-solution.json: solution.name (string replace), solution.id
    const psPath = path.join(projectDir, "config", "package-solution.json");
    const ps = await readJsonIfExists<any>(psPath);
    if (ps?.solution) {
        if (opts.rename && typeof ps.solution.name === "string" && oldName) {
            // match M365 CLI approach: replace occurrences of previous package name in the solution name
            ps.solution.name = ps.solution.name.replace(new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), opts.rename);
        }
        if (opts.newId && typeof ps.solution.id === "string") {
            ps.solution.id = opts.newId;
        }
        await writeJsonPretty(psPath, ps);
    }

    // config/deploy-azure-storage.json (optional): container
    const dazPath = path.join(projectDir, "config", "deploy-azure-storage.json");
    const daz = await readJsonIfExists<any>(dazPath);
    if (daz && opts.rename && typeof daz.container === "string") {
        daz.container = opts.rename;
        await writeJsonPretty(dazPath, daz);
    }

    // README.md (optional): string replace oldName -> newName
    const readmePath = path.join(projectDir, "README.md");
    if (opts.rename && oldName) {
        try {
            const existing = await fs.readFile(readmePath, "utf8");
            const updated = existing.replace(new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), opts.rename);
            if (updated !== existing) {
                await fs.writeFile(readmePath, updated, "utf8");
            }
        } catch {
            // README doesn't exist in some samples; ignore
        }
    }
}

export async function postProcessProject(projectPath: string, options: CliOptions, spinner?: ReturnType<typeof ora>): Promise<void> {
    const rename = options.rename?.trim();
    let newId: string | undefined;

    if (options.newid) {
        if (typeof options.newid === "string") {
            const v = options.newid.trim();
            if (!isGuid(v)) {
                throw new Error(`--newid must be a GUID (or omit the value to auto-generate one). Received: ${v}`);
            }
            newId = v;
        } else {
            // flag was provided without a value
            newId = randomUUID();
        }
    }

    if (rename || newId) {
        spinner && (spinner.text = `Updating project metadata${rename ? ` (rename → ${rename})` : ""}${newId ? " (new id)" : ""}…`);
        await renameSpfxProject(projectPath, { rename, newId });
    }
}


const program = new Command();

program
    .name("spfx-sample")
    .description("Fetch a single sample folder from a large GitHub repo using git sparse-checkout (no full clone).")
    .version("0.3.0", "-v, --version", "output the current version");

// Respect NO_COLOR environment variable (https://no-color.org/) or explicit flag
const envNoColor = typeof process.env.NO_COLOR !== "undefined";


program
        .command("get")
        .argument("<sample>", "Sample folder name, e.g. react-hello-world OR samples/react-hello-world")
        .option("--owner <owner>", "GitHub org/user", DEFAULT_OWNER)
        .option("--repo <repo>", "GitHub repository name", DEFAULT_REPO)
        .option("--ref <ref>", "Git ref (branch, tag, or commit SHA)", DEFAULT_REF)
        .option("--dest <dest>", "Destination folder (default varies by --mode)")
        .option("--rename <newName>", "Rename the downloaded SPFx project (package.json/.yo-rc.json/package-solution.json/README)")
        .option("--newid [id]", "Generate or set a new SPFx solution id (GUID). If omitted value, a new GUID is generated.")
        .option("--mode <mode>", 'Mode: "extract" (copy sample out) or "repo" (leave sparse repo)', "extract")
        .option("--method <method>", 'Method: "auto" (git if available, else api), "git", or "api"', "auto")
        .option("--force", "Overwrite destination if it exists", false)
        .option("--verbose", "Print git output", false)
        .option("--no-color", "Disable ANSI colors", false)

    .action(async (sample: string, options: CliOptions) => {
        // If NO_COLOR env var set or user passed --no-color, disable chalk output
        if (envNoColor || options.noColor) {
            try {
                // Chalk v5: setting level to 0 disables colors
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (chalk as any).level = 0;
            } catch {
                // ignore
            }
        }
        const sampleFolder = normalizeSampleArg(sample);
        const ref = options.ref || DEFAULT_REF;
        const repo = options.repo || DEFAULT_REPO;
        const owner = options.owner || DEFAULT_OWNER;
        const verbose = !!options.verbose;

        let mode: Mode;
        try {
            mode = assertMode(options.mode);
        } catch (e) {
            console.error(chalk.red((e as Error).message));
            process.exitCode = 1;
            return;
        }

        let method: Method;
        try {
            method = assertMethod(options.method);
        } catch (e) {
            console.error(chalk.red((e as Error).message));
            process.exitCode = 1;
            return;
        }

        // Default dest differs by mode:
        // - extract: ./<sampleFolder>
        // - repo:    ./<repo>-<sampleFolder>
        const defaultDest =
            mode === "extract" ? `./${sampleFolder}` : `./${repo}-${sampleFolder}`.replaceAll("/", "-");

        const destDir = path.resolve(options.dest ?? defaultDest);

        // Decide method (auto => git if available, else api)
        const gitAvailable = await isGitAvailable(verbose);
        const chosen: Method = method === "auto" ? (gitAvailable ? "git" : "api") : method;
        if (verbose) console.error(`[debug] method=${method} gitAvailable=${gitAvailable} chosen=${chosen}`);

        // If using git, validate git version/features
        if (chosen === "git") {
            try {
                await ensureGit(verbose);
            } catch (e) {
                console.error(chalk.red((e as Error).message));
                process.exitCode = 1;
                return;
            }
        }

        // API method can only do "extract" (no .git working repo)
        if (chosen === "api" && mode === "repo") {
            console.error(chalk.red(`--mode repo requires --method git (API method cannot create a git working repo).`));
            process.exitCode = 1;
            return;
        }

        // Handle destination
        if (await pathExists(destDir)) {
            if (!options.force) {
                const nonEmpty = await isDirNonEmpty(destDir);
                if (nonEmpty) {
                    console.error(
                        chalk.red(`Destination exists and is not empty: ${destDir}\n`) +
                        chalk.yellow(`Use --force to overwrite (or choose --dest).`)
                    );
                    process.exitCode = 1;
                    return;
                }
            } else {
                await fs.rm(destDir, { recursive: true, force: true });
            }
        }

        const spinner = ora(`Getting sample ${sampleFolder} from ${owner}/${repo}@${ref}…`).start();

        // Show concise phase updates
        spinner.text = `Preparing to fetch (method=${chosen})…`;

        // Allow aborting long-running operations (downloads, git) via Ctrl-C
        const controllers: AbortController[] = [];
        const topController = new AbortController();
        controllers.push(topController);

        const onSigint = () => {
            spinner && spinner.fail("Aborted by user.");
            for (const c of controllers) c.abort();
            // Standard unix convention: 128 + SIGINT(2) = 130
            process.exit(130);
        };
        process.once("SIGINT", onSigint);

        try {
            if (chosen === "api") {
                spinner.text = `Downloading files via GitHub API…`;
                // Tokenless API method: download only that sample folder via subtree tree-walk + raw URLs
                await fs.mkdir(destDir, { recursive: true });

                // Render a progress bar. We don't know total until download begins, so create lazily.
                let bar: ProgressBar | null = null;
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
                        // Create bar when we know `total`
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
                            // tick to current count (ProgressBar expects increments)
                            const delta = done - (bar.curr || 0);
                            if (delta > 0) bar.tick(delta, { file: path.basename(filePath) });
                        } else {
                            // fallback to spinner text updates, throttle to avoid spam
                            const now = Date.now();
                            if (now - lastRendered > 150) {
                                spinner.text = `Downloading (${done}/${total})… ${filePath}`;
                                lastRendered = now;
                            }
                        }
                    }
                });

                spinner.text = `Post-processing project files…`;
                await postProcessProject(destDir, options, spinner);
                await finalizeExtraction({
                    spinner,
                    successMessage: `Done! Downloaded ${chalk.cyan(`samples/${sampleFolder}`)} into ${chalk.green(destDir)}`,
                    projectPath: destDir
                });
                return;
            }

            // chosen === "git"
            if (mode === "extract") {
                spinner.text = `Performing sparse git extract…`;
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

                spinner.text = `Post-processing project files…`;
                await postProcessProject(destDir, options, spinner);
                await finalizeExtraction({
                    spinner,
                    successMessage: `Done! Extracted ${chalk.cyan(`samples/${sampleFolder}`)} into ${chalk.green(destDir)}`,
                    projectPath: destDir
                });

            } else {
                // repo mode: sparse clone directly into destDir and keep .git there
                await fs.mkdir(destDir, { recursive: true });

                spinner.text = `Performing sparse git clone (repo mode)…`;
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

                const samplePath = path.join(destDir, "samples", sampleFolder);

                await postProcessProject(samplePath, options, spinner);
                await finalizeExtraction({
                    spinner,
                    successMessage: `Done! Sparse repo ready at ${chalk.green(destDir)} (sample at ${chalk.cyan(samplePath)})`,
                    projectPath: samplePath,
                    repoRoot: destDir
                });
            }
        } catch (err) {
            spinner.fail((err as Error).message);
            process.exitCode = 1;
        }
    });

/**
 * Testable handler for the `get` command. Allows injecting dependencies for unit testing.
 */
export async function getCommandHandler(sample: string, options: CliOptions, deps?: {
    download?: typeof downloadSampleViaGitHubSubtree;
    fetchSparse?: typeof fetchSampleViaSparseGitExtract;
    sparseClone?: typeof sparseCloneInto;
    postProcess?: typeof postProcessProject;
    finalize?: typeof finalizeExtraction;
    isGitAvailable?: typeof isGitAvailable;
    ensureGit?: typeof ensureGit;
}) {
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

    let mode: Mode;
    try {
        mode = assertMode(options.mode);
    } catch (e) {
        throw e;
    }

    let method: Method;
    try {
        method = assertMethod(options.method);
    } catch (e) {
        throw e;
    }

    const defaultDest = mode === "extract" ? `./${sampleFolder}` : `./${repo}-${sampleFolder}`.replaceAll("/", "-");
    const destDir = path.resolve(options.dest ?? defaultDest);

    const gitAvailable = await gitAvailableFn(verbose);
    const chosen: Method = method === "auto" ? (gitAvailable ? "git" : "api") : method;

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
            await fs.rm(destDir, { recursive: true, force: true });
        }
    }

    if (chosen === "api") {
        await fs.mkdir(destDir, { recursive: true });
        await download({ owner, repo, ref, sampleFolder, destDir, concurrency: 8, verbose, signal: undefined, onProgress: undefined });
        await postProcess(destDir, options, undefined);
        await finalize({ spinner: undefined, successMessage: `Done`, projectPath: destDir });
        return;
    }

    if (chosen === "git") {
        if (mode === "extract") {
            await fetchSparse({ owner, repo, ref, sampleFolder, destDir, verbose, spinner: undefined, signal: undefined });
            await postProcess(destDir, options, undefined);
            await finalize({ spinner: undefined, successMessage: `Done`, projectPath: destDir });
            return;
        } else {
            await fs.mkdir(destDir, { recursive: true });
            await sparseClone({ owner, repo, ref, sampleFolder, repoDir: destDir, verbose, spinner: undefined, signal: undefined });
            const samplePath = path.join(destDir, "samples", sampleFolder);
            await postProcess(samplePath, options, undefined);
            await finalize({ spinner: undefined, successMessage: `Done`, projectPath: samplePath, repoRoot: destDir });
            return;
        }
    }
}

program
    .command("rename")
    .argument("<path>", "Path to previously downloaded sample folder (project root)")
    .option("--newname <newName>", "Rename the SPFx project (package.json/.yo-rc.json/package-solution.json/README)")
    .option("--newid [id]", "Generate or set a new SPFx solution id (GUID). If omitted value, a new GUID is generated.")
    .option("--verbose", "Print debug output", false)
    .option("--no-color", "Disable ANSI colors", false)
    .action(async (p: string, options: { newname?: string; newid?: string | boolean; verbose?: boolean; noColor?: boolean }) => {
        if (envNoColor || options.noColor) {
            try { (chalk as any).level = 0; } catch {}
        }

        const projectPath = path.resolve(p);

        // Validate path exists
        if (!(await pathExists(projectPath))) {
            console.error(chalk.red(`Path not found: ${projectPath}`));
            process.exitCode = 1;
            return;
        }

        const opts: CliOptions = { rename: options.newname, newid: typeof options.newid === 'string' ? options.newid : options.newid ? true : undefined } as any;

        const spinner = ora(`Renaming project at ${projectPath}…`).start();
        try {
            await postProcessProject(projectPath, opts, spinner);
            spinner.succeed(`Updated project at ${projectPath}`);
        } catch (err) {
            spinner.fail((err as Error).message);
            process.exitCode = 1;
        }
    });

if (process.env.NODE_ENV !== "test") {
    program.parse(process.argv);
}
