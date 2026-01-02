import path from "node:path";
import fs from "node:fs/promises";

type TreeItem = { path: string; type: "blob" | "tree"; sha: string };
type TreeResponse = { tree: TreeItem[]; truncated?: boolean; message?: string };

/**
 * Options for downloading a subtree (a specific folder and its contents) from a GitHub repository.
 *
 * Provides the repository identity, the Git reference to fetch from, the path of the folder inside
 * the repository to download, and where to write the files locally. Also allows tuning concurrency
 * and reporting progress.
 *
 * @property owner - The GitHub repository owner (for example: "pnp").
 * @property repo - The repository name (for example: "sp-dev-fx-webparts").
 * @property ref - The Git reference to download from; can be a branch name, tag, or commit SHA.
 * @property sampleFolder - The path to the folder inside the repository that should be downloaded
 *                          (for example: "react-hello-world").
 * @property destDir - Local destination directory where the downloaded files will be written.
 * @property concurrency - Optional maximum number of concurrent network/file operations. Defaults to 8.
 * @property onProgress - Optional callback invoked to report progress. Called with (done, total, filePath)
 *                        where `done` is the number of files already processed, `total` is the total
 *                        number of files to process, and `filePath` is the path of the file most recently processed.
 *
 * @example
 * // Example usage:
 * // {
 * //   owner: "pnp",
 * //   repo: "sp-dev-fx-webparts",
 * //   ref: "v1.0.0",
 * //   sampleFolder: "react-hello-world",
 * //   destDir: "./samples/react-hello-world",
 * //   concurrency: 8,
 * //   onProgress: (done, total, filePath) => { console.log(`${done}/${total}: ${filePath}`); }
 * // }
 *
 */
export type DownloadSubtreeOptions = {
    owner: string;          // e.g. "pnp"   
    repo: string;           // e.g. "sp-dev-fx-webparts"
    ref: string;            // branch/tag/sha
    sampleFolder: string;   // e.g. "react-hello-world"
    destDir: string;        // where to write files
    concurrency?: number;   // default 8
    onProgress?: (done: number, total: number, filePath: string) => void;
};


/**
 * Creates a simple counting semaphore to limit the number of concurrently running asynchronous tasks.
 *
 * The returned function accepts an async function (a function that returns a Promise)
 * and schedules its execution. If the number of currently running tasks is below the
 * specified maximum, the provided function is invoked immediately; otherwise it is
 * enqueued and will be invoked in FIFO order when a slot becomes available.
 *
 * @template T - The resolved type of the Promise returned by the scheduled function.
 * @param max - Maximum number of tasks allowed to run concurrently. Should be a positive integer (>= 1).
 *              If a non-positive value is supplied, tasks will be enqueued and none will start,
 *              so pass a positive value to avoid deadlock.
 * @returns A function that takes an async function `fn: () => Promise<T>` and returns a `Promise<T>`
 *          that resolves or rejects with the result of `fn`. The semaphore ensures that at most
 *          `max` invocations of `fn` are running at any given time. When a running task settles
 *          (either fulfills or rejects), the semaphore decrements its internal counter and starts
 *          the next queued task (if any).
 *
 * @remarks
 * - Errors thrown or rejections from the provided function are propagated to the caller of the
 *   returned scheduling function; the semaphore still releases the slot (so subsequent queued tasks run).
 * - Queue ordering is FIFO: tasks are started in the order they were scheduled when slots free up.
 *
 * @example
 * // Create a semaphore allowing 3 concurrent tasks
 * const sem = createSemaphore(3);
 *
 * // Schedule work
 * const result = await sem(async () => {
 *   // perform async work here
 *   return await fetchData();
 * });
 */
function createSemaphore(max: number) {
    let running = 0;
    const queue: Array<() => void> = [];
    const next = () => {
        running--;
        const fn = queue.shift();
        if (fn) fn();
    };
    return async <T>(fn: () => Promise<T>): Promise<T> =>
        new Promise<T>((resolve, reject) => {
            const run = async () => {
                running++;
                try { resolve(await fn()); }
                catch (e) { reject(e); }
                finally { next(); }
            };
            if (running < max) run();
            else queue.push(run);
        });
}

/**
 * Fetches JSON from the given URL and returns it typed as T.
 *
 * @template T - The expected shape of the parsed JSON response.
 * @param url - The URL to fetch.
 * @returns A promise that resolves to the parsed JSON cast to T.
 * @throws {Error} If the response is not ok, including a friendly message when the
 *  GitHub anonymous rate limit is hit, or if JSON parsing fails. Network errors
 *  from the Fetch API will also propagate as rejected promises.
 *
 * @remarks
 * - Adds a "User-Agent": "@pnp/spfx-sample" header to the request.
 * - On non-ok responses, prefers the API-provided error message (data.message)
 *   when available; otherwise includes the HTTP status and statusText.
 * - Detects GitHub anonymous rate limiting: when status is 403 and the
 *   "X-RateLimit-Remaining" header equals "0", throws a specific rate-limit error
 *   advising to retry later or use the git method.
 * - Uses response.json() to parse the body; callers should expect parsing errors
 *   if the response is not valid JSON.
 */
async function fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: { "User-Agent": "@pnp/spfx-sample" } });
    const data = (await res.json()) as any;

    if (!res.ok) {
        // friendly rate-limit message
        if (res.status === 403 && res.headers.get("X-RateLimit-Remaining") === "0") {
            throw new Error(
                "GitHub anonymous rate limit hit (60/hr per IP). Try again later, or install/use the git method."
            );
        }
        throw new Error(`GitHub API error: ${data?.message ?? `${res.status} ${res.statusText}`}`);
    }

    return data as T;
}

/**
 * Fetches a Git tree object from the GitHub REST API for the specified repository.
 *
 * The function constructs a GET request to:
 *   https://api.github.com/repos/{owner}/{repo}/git/trees/{treeish}
 * and, if `recursive` is true, appends the `?recursive=1` query to retrieve the entire
 * subtree (all nested trees and blobs).
 *
 * @param owner - The owner (user or organization) of the GitHub repository.
 * @param repo - The name of the GitHub repository.
 * @param treeish - A tree-ish reference that identifies the tree to fetch (branch name, tag, or commit SHA).
 *                   This value is URL-encoded before being placed into the request path.
 * @param recursive - When true, requests the tree recursively (including nested trees/blobs). Defaults to false.
 *
 * @returns A promise that resolves to the parsed TreeResponse returned by the GitHub API.
 *
 * @throws Will reject if the network request fails or if the API returns an error status (see fetchJson behavior).
 *
 * @remarks
 * - The request is subject to GitHub API rate limits and may require authentication depending on repository visibility and rate usage.
 * - The exact shape of TreeResponse is defined elsewhere in the codebase and mirrors the GitHub API's tree response structure.
 */
async function fetchTree(owner: string, repo: string, treeish: string, recursive = false): Promise<TreeResponse> {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(treeish)}${recursive ? "?recursive=1" : ""}`;
    return fetchJson<TreeResponse>(url);
}

/**
 * Ensures that the directory containing the given file path exists by creating it (and any necessary parent directories) if absent.
 *
 * @param filePath - The full path to the file whose containing directory should be created.
 * @returns A promise that resolves when the directory has been created or already exists.
 * @remarks
 * This function uses a recursive directory creation strategy (fs.mkdir with { recursive: true }) and does not create the file itself.
 * If the operation fails, the returned promise will reject with the underlying filesystem error.
 *
 * @example
 * // Ensure the directory for "/tmp/data/output.txt" exists before writing the file
 * await ensureDirForFile("/tmp/data/output.txt");
 */
async function ensureDirForFile(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
}

/**
 * Downloads all files from a sample subfolder in a GitHub repository using the GitHub tree API
 * (to enumerate files) and raw.githubusercontent.com (to fetch file contents).
 *
 * The function expects the repository to have a top-level "samples" folder and will locate the
 * specific sample by name (samples/<sampleFolder>). It enumerates the sample subtree recursively,
 * filters for blob entries (files), and downloads each file in parallel (bounded by a semaphore).
 * Directory structure from the sample is recreated under the provided destination directory.
 *
 * @remarks
 * - Uses a helper `fetchTree(owner, repo, refOrSha, recursive)` to list git trees. If that helper
 *   returns an error object (has a `message`), the function will throw with that message.
 * - If the recursive tree listing is truncated, this function will throw and recommend using the
 *   alternate git-based method.
 * - Files are fetched from raw.githubusercontent.com using the provided ref (URL-encoded) and the
 *   full path `samples/<sampleFolder>/<relativePath>`.
 * - Destination directories are created as needed before writing files.
 * - Progress is reported via an optional callback after each successfully written file.
 *
 * @param opts - Options describing which repository/sample to download and how.
 * @param opts.owner - GitHub repository owner (user or organization).
 * @param opts.repo - GitHub repository name.
 * @param opts.ref - Git reference to use (branch name, tag, or commit SHA).
 * @param opts.sampleFolder - Name of the sample folder inside the repository's top-level "samples" directory.
 * @param opts.destDir - Local filesystem directory to write the downloaded files into. The sample's
 *                       relative paths are preserved under this directory.
 * @param opts.concurrency - Optional. Maximum number of concurrent HTTP downloads. Defaults to 8.
 * @param opts.onProgress - Optional. Callback invoked after each file is written with signature
 *                          (done: number, total: number, filePath: string) where `filePath` is the
 *                          repository path (samples/<sampleFolder>/<relativePath>) of the file just downloaded.
 *
 * @async
 * @returns A Promise that resolves when all files have been downloaded and written to disk.
 *
 * @throws Error if:
 * - the repository root or expected "samples" tree cannot be found,
 * - the requested sample folder under "samples" does not exist,
 * - the recursive tree listing is truncated,
 * - no files (blobs) are found in the sample folder,
 * - any HTTP request for a file returns a non-OK response,
 * - file system operations (directory creation or file writes) fail,
 * - or if the underlying `fetchTree` helper returns an error message.
 */
export async function downloadSampleViaGitHubSubtree(opts: DownloadSubtreeOptions): Promise<void> {
    const { owner, repo, ref, sampleFolder, destDir } = opts;
    const concurrency = opts.concurrency ?? 8;

    // root tree
    const root = await fetchTree(owner, repo, ref, false);
    if (root.message) throw new Error(root.message);

    const samplesTree = root.tree.find(t => t.type === "tree" && t.path === "samples");
    if (!samplesTree) throw new Error(`Could not find /samples at ${owner}/${repo}@${ref}`);

    // /samples tree
    const samples = await fetchTree(owner, repo, samplesTree.sha, false);
    const sampleTree = samples.tree.find(t => t.type === "tree" && t.path === sampleFolder);
    if (!sampleTree) throw new Error(`Sample folder not found: samples/${sampleFolder} at ${ref}`);

    // sample subtree (recursive)
    const sample = await fetchTree(owner, repo, sampleTree.sha, true);
    if (sample.truncated) {
        // extremely unlikely for a single sample, but handle anyway
        throw new Error(`Tree listing truncated for samples/${sampleFolder}. Use the git method.`);
    }

    const blobs = sample.tree.filter(t => t.type === "blob");
    if (blobs.length === 0) throw new Error(`No files found in samples/${sampleFolder}`);

    await fs.mkdir(destDir, { recursive: true });

    const sem = createSemaphore(concurrency);
    let done = 0;

    await Promise.all(
        blobs.map(b =>
            sem(async () => {
                const rel = b.path; // path relative to samples/<sampleFolder>
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
