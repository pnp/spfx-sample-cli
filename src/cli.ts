#!/usr/bin/env node
/* eslint-disable no-console */
import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { downloadSampleViaGitHubSubtree } from "./githubPartialSubtree";
import detectVersionManagers from "./detectVersionManagers";
import detectServeCommand from "./detectServeCommand";
import type { CliOptions, Mode, Method } from "./cliOptions";


const DEFAULT_OWNER = "pnp";
const DEFAULT_REPO = "sp-dev-fx-webparts";
const DEFAULT_REF = "main";

function normalizeSampleArg(sample: string): string {
    // Allow either "react-my-sample" OR "samples/react-my-sample"
    const s = sample.replaceAll("\\", "/").trim();
    if (s.startsWith("samples/")) return s.slice("samples/".length);
    return s;
}

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
    opts: { cwd?: string; verbose?: boolean } = {}
): Promise<RunResult> {
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
            else reject(new Error(`${cmd} ${args.join(" ")} failed (exit ${code}).\n${stderr || stdout}`));
        });
    });
}

function parseGitVersion(output: string): { major: number; minor: number; patch: number } | null {
    const m = output.match(/git version (\d+)\.(\d+)\.(\d+)/i);
    if (!m) return null;
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function versionGte(
    v: { major: number; minor: number; patch: number },
    min: { major: number; minor: number; patch: number }
): boolean {
    if (v.major !== min.major) return v.major > min.major;
    if (v.minor !== min.minor) return v.minor > min.minor;
    return v.patch >= min.patch;
}

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
}): Promise<void> {
    const { owner, repo, ref, sampleFolder, repoDir, verbose, spinner } = args;

    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    const sparsePath = `samples/${sampleFolder}`.replaceAll("\\", "/");

    spinner && (spinner.text = `Cloning (partial) ${owner}/${repo}…`);
    await run(
        "git",
        ["clone", "--depth=1", "--filter=blob:none", "--no-checkout", repoUrl, repoDir],
        { verbose }
    );

    spinner && (spinner.text = `Enabling sparse checkout…`);
    await run("git", ["-C", repoDir, "sparse-checkout", "init", "--cone"], { verbose });

    spinner && (spinner.text = `Selecting ${sparsePath}…`);
    await run("git", ["-C", repoDir, "sparse-checkout", "set", sparsePath], { verbose });

    spinner && (spinner.text = `Fetching ref ${ref}…`);
    await run("git", ["-C", repoDir, "fetch", "--depth=1", "--filter=blob:none", "origin", ref], {
        verbose
    });

    spinner && (spinner.text = `Checking out ${ref}…`);
    await run("git", ["-C", repoDir, "checkout", "--detach", "FETCH_HEAD"], { verbose });

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
}): Promise<void> {
    const { owner, repo, ref, sampleFolder, destDir, verbose, spinner } = args;

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spfx-sample-"));
    const tmpRepoDir = path.join(tmpRoot, "repo");

    try {
        await sparseCloneInto({ owner, repo, ref, sampleFolder, repoDir: tmpRepoDir, verbose, spinner });

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

function assertMode(m: string | undefined): Mode {
    if (!m) return "extract";
    if (m === "extract" || m === "repo") return m;
    throw new Error(`Invalid --mode "${m}". Use "extract" or "repo".`);
}

const program = new Command();

program
    .name("spfx-sample")
    .description("Fetch a single sample folder from a large GitHub repo using git sparse-checkout (no full clone).")
    .version("0.3.0");

program
        .command("get")
        .argument("<sample>", "Sample folder name, e.g. react-hello-world OR samples/react-hello-world")
        .option("--owner <owner>", "GitHub org/user", DEFAULT_OWNER)
        .option("--repo <repo>", "GitHub repository name", DEFAULT_REPO)
        .option("--ref <ref>", "Git ref (branch, tag, or commit SHA)", DEFAULT_REF)
        .option("--dest <dest>", "Destination folder (default varies by --mode)")
        .option("--mode <mode>", 'Mode: "extract" (copy sample out) or "repo" (leave sparse repo)', "extract")
        .option("--method <method>", 'Method: "auto" (git if available, else api), "git", or "api"', "auto")
        .option("--force", "Overwrite destination if it exists", false)
        .option("--verbose", "Print git output", false)

    .action(async (sample: string, options: CliOptions) => {
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

        try {
            if (chosen === "api") {
                // Tokenless API method: download only that sample folder via subtree tree-walk + raw URLs
                await fs.mkdir(destDir, { recursive: true });

                await downloadSampleViaGitHubSubtree({
                    owner,
                    repo,
                    ref,
                    sampleFolder,
                    destDir,
                    concurrency: 8,
                    onProgress: (done, total, filePath) => {
                        spinner.text = `Downloading (${done}/${total})… ${filePath}`;
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
                try {
                    const serve = await detectServeCommand(destDir);
                    console.log(chalk.white(`  ${chalk.yellow(serve.cmd)} ${chalk.white(serve.args?.join(" ") ?? "")}`));
                } catch {
                    console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("run serve")}`));
                }
                return;
            }

            // chosen === "git"
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
                try {
                    const serve = await detectServeCommand(destDir);
                    console.log(chalk.white(`  ${chalk.yellow(serve.cmd)} ${chalk.white(serve.args?.join(" ") ?? "")}`));
                } catch {
                    console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("run serve")}`));
                }

            } else {
                // repo mode: sparse clone directly into destDir and keep .git there
                await fs.mkdir(destDir, { recursive: true });

                await sparseCloneInto({
                    owner,
                    repo,
                    ref,
                    sampleFolder,
                    repoDir: destDir,
                    verbose,
                    spinner
                });

                const samplePath = path.join(destDir, "samples", sampleFolder);

                spinner.succeed(
                    `Done! Sparse repo ready at ${chalk.green(destDir)} (sample at ${chalk.cyan(samplePath)})`
                );

                console.log();
                console.log(`  ${chalk.yellow("cd")} ${chalk.blue(`"${samplePath}"`)}`);
                await maybePrintNvmrcAdvice(samplePath);
                console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("i")}`));
                try {
                    const serve = await detectServeCommand(samplePath);
                    console.log(chalk.white(`  ${chalk.yellow(serve.cmd)} ${chalk.white(serve.args?.join(" ") ?? "")}`));
                } catch {
                    console.log(chalk.white(`  ${chalk.yellow("npm")} ${chalk.white("run serve")}`));
                }
                console.log();
                console.log(chalk.green("Contribute back:"));
                console.log(`  ${chalk.yellow("cd")} ${chalk.blue(`"${destDir}"`)}`);

                console.log(chalk.white(`  ${chalk.yellow("git")} ${chalk.white("status")}`));
                console.log(chalk.white(`  ${chalk.yellow("git")} ${chalk.white("checkout")} ${chalk.gray("-b")} ${chalk.white("my-change")}`));
            }
        } catch (err) {
            spinner.fail((err as Error).message);
            process.exitCode = 1;
        }
    });

program.parse(process.argv);
