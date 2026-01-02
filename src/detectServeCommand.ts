import { readFile } from "node:fs/promises";
import path from "node:path";

export type ServeCommand = { cmd: string; args?: string[] };

/**
 * Inspect a project's package.json and files to recommend a serve command.
 * - If package.json scripts include "start" or "serve", prefer those.
 * - If project uses "heft" (devDependency or script), recommend "npm run start" (heft convention).
 * - If Gulpfile exists or gulp present in devDependencies, recommend "gulp serve".
 */
export async function detectServeCommand(projectDir: string): Promise<ServeCommand> {
  const pkgPath = path.join(projectDir, "package.json");
  try {
    const txt = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(txt);

    // If explicit scripts exist, prefer them
    if (pkg.scripts) {
      if (pkg.scripts.start) return { cmd: "npm", args: ["run", "start"] };
      if (pkg.scripts.serve) return { cmd: "npm", args: ["run", "serve"] };
    }

    // Check devDependencies / dependencies for heft or gulp
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.heft || deps["@microsoft/heft"]) {
      // Heft-based projects typically use `npm start` (heft start)
      return { cmd: "npm", args: ["run", "start"] };
    }
    if (deps.gulp || deps["gulp-cli"]) {
      return { cmd: "gulp", args: ["serve"] };
    }
  } catch {
    // ignore file read/parse errors
  }

  // Fallback: check for gulpfile
  try {
    const gf = path.join(projectDir, "gulpfile.js");
    // only check existence synchronously via require('fs').existsSync to avoid extra async imports
    // but to keep API minimal, use try/catch with readFile
    await readFile(gf, "utf8");
    return { cmd: "gulp", args: ["serve"] };
  } catch {
    // noop
  }

  // Default fallback
  return { cmd: "npm", args: ["run", "serve"] };
}

export default detectServeCommand;
