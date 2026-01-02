import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function which(cmd: string): string | null {
  const runner = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [cmd] : ["-v", cmd];
  try {
    const res = spawnSync(runner, args, { encoding: "utf8", shell: false });
    if (res.status === 0) {
      const out = (res.stdout || res.stderr || "").split(/\r?\n/).find(Boolean);
      return out ? out.trim() : null;
    }
  } catch {
    // ignore
  }
  return null;
}

export type VersionManagers = {
  nvmPosix: boolean;
  nvmPosixDir?: string | null;
  nvmWindows: boolean;
  nvmWindowsPath?: string | null;
  nvs: boolean;
  nvsPath?: string | null;
};

/**
 * Detect whether common Node version managers are installed on the host.
 * - `nvm` (POSIX) is typically detected via NVM_DIR or ~/.nvm
 * - `nvm-windows` is detected via NVM_HOME/NVM_SYMLINK or nvm.exe on PATH
 * - `nvs` is detected via NVS_HOME or `nvs` on PATH
 */
export async function detectVersionManagers(): Promise<VersionManagers> {
  const found: VersionManagers = { nvmPosix: false, nvmPosixDir: null, nvmWindows: false, nvmWindowsPath: null, nvs: false, nvsPath: null };

  // POSIX nvm
  if (process.env.NVM_DIR) {
    found.nvmPosix = true;
    found.nvmPosixDir = process.env.NVM_DIR;
  } else {
    const maybe = path.join(os.homedir(), ".nvm");
    if (await exists(maybe)) {
      found.nvmPosix = true;
      found.nvmPosixDir = maybe;
    }
  }

  // nvm-windows
  if (process.env.NVM_HOME || process.env.NVM_SYMLINK) {
    found.nvmWindows = true;
    found.nvmWindowsPath = process.env.NVM_HOME ?? process.env.NVM_SYMLINK ?? null;
  } else {
    const w = which(process.platform === "win32" ? "nvm.exe" : "nvm");
    if (w) {
      // on Windows this will be nvm.exe; on POSIX seeing `nvm` is ambiguous (often a shell function)
      if (process.platform === "win32" || w.toLowerCase().endsWith("nvm.exe")) {
        found.nvmWindows = true;
        found.nvmWindowsPath = w;
      }
    }
  }

  // nvs
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

export default detectVersionManagers;
