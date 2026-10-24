/**
 * Chrome discovery — the low-level `--version` probe and the on-disk/identity
 * helpers it rides on.
 *
 * The one place discovery reaches outside the process: `chromePath --version`
 * run through a scrubbed parent env under a bounded timeout, the rule that says
 * whether a path is worth spawning at all (a directory, socket or fifo never
 * reaches a probe — a Chrome-less host must run one scan that launches nothing),
 * and the identity key that folds two spellings of the same binary into one
 * answer. The scan that drives them lives in ./scan.ts.
 */
import { spawn } from "node:child_process";
import { accessSync, constants, readdirSync, realpathSync, statSync } from "node:fs";
import * as path from "node:path";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";

import { CHECK_TIMEOUT_MS, WINDOWS_VERSION_UNKNOWN } from "../constants.js";
import { firstLine } from "../status.js";

/** A Chromium install's version folder name: `155.0.8059.85`. */
const VERSION_FOLDER = /^\d+\.\d+\.\d+\.\d+$/u;

/** The "not found" rejection, carrying code "ENOENT" for the scan to drop. */
function missingExecutable(target: string): Error {
    const missing = new Error(`Chrome executable not found: ${target}`);
    Object.defineProperty(missing, "code", { value: "ENOENT", writable: true, enumerable: false, configurable: true });
    return missing;
}

/**
 * The version a Windows install states without being run: the highest
 * `<major>.<minor>.<build>.<patch>` folder beside the executable (the layout
 * Chrome, Edge, Brave and Chromium all install with), or
 * {@link WINDOWS_VERSION_UNKNOWN} when none is there. A missing file rejects
 * like the spawn would; a bare name (no folder to look in) answers unknown.
 */
export function readWindowsInstallVersion(target: string): string {
    const win = path.win32;
    if (!target.includes("/") && !target.includes("\\")) return WINDOWS_VERSION_UNKNOWN;
    let isFile = false;
    try {
        isFile = statSync(target).isFile();
    } catch {
        // Absent — answered below like a spawn's ENOENT.
    }
    if (!isFile) throw missingExecutable(target);
    let names: string[];
    try {
        names = readdirSync(win.dirname(target));
    } catch {
        return WINDOWS_VERSION_UNKNOWN;
    }
    const versions = names.filter((name) => VERSION_FOLDER.test(name));
    if (versions.length === 0) return WINDOWS_VERSION_UNKNOWN;
    const parts = (name: string) => name.split(".").map(Number);
    versions.sort((a, b) => {
        const [pa, pb] = [parts(a), parts(b)];
        for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
        return 0;
    });
    return versions[versions.length - 1];
}

/**
 * Answer one executable's version. On Windows nothing is spawned — a Chromium
 * browser asked `--version` there opens a window instead of answering — and
 * the version is read off the install ({@link readWindowsInstallVersion}).
 * Everywhere else: one `chromePath --version` probe (scrubbed parent env,
 * bounded timeout). Resolves the first stdout line (the version); ENOENT
 * rejects with "Chrome executable not found: <path>" carrying code "ENOENT"; a
 * non-zero exit rejects with the first non-empty stderr/stdout line.
 */
export function probeExecutable(target: string, platform: NodeJS.Platform = process.platform): Promise<string> {
    if (platform === "win32") {
        try {
            return Promise.resolve(readWindowsInstallVersion(target));
        } catch (error) {
            return Promise.reject(error);
        }
    }
    return new Promise((resolve, reject) => {
        let child: ReturnType<typeof spawn>;
        try {
            child = spawn(target, ["--version"], {
                env: scrubbedParentEnv(),
                stdio: ["ignore", "pipe", "pipe"],
                timeout: CHECK_TIMEOUT_MS,
                killSignal: "SIGKILL"
            });
        } catch (error) {
            reject(new Error(`could not run "${target} --version": ${String(error)}`));
            return;
        }
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk: Uint8Array) => (stdout += chunk));
        child.stderr?.on("data", (chunk: Uint8Array) => (stderr += chunk));
        child.on("error", (error: NodeJS.ErrnoException) => {
            const code = error && typeof error.code === "string" ? error.code : "";
            if (code === "ENOENT") {
                reject(missingExecutable(target));
                return;
            }
            reject(new Error(`could not run "${target} --version": ${String(error)}`));
        });
        child.on("close", (code: number | null) => {
            if (code === null) {
                reject(new Error(`"${target} --version" timed out after ${String(CHECK_TIMEOUT_MS)}ms`));
                return;
            }
            if (code !== 0) {
                const detail =
                    firstLine(stderr) !== "" ? firstLine(stderr) : firstLine(stdout) !== "" ? firstLine(stdout) : `exit code ${String(code)}`;
                reject(new Error(`"${target} --version" failed: ${detail}`));
                return;
            }
            resolve(firstLine(stdout));
        });
    });
}

/** True when a candidate path can be handed to the OS for a `--version` probe.
 * A path that is absent (or not executable) never reaches the spawn: a
 * Chrome-less host runs one scan without launching anything. Paths with no
 * directory separator go straight to the spawn so the OS resolves them
 * through `PATH`. */
export function presentOnDisk(candidate: string): boolean {
    if (!candidate.includes("/") && !candidate.includes("\\")) return true;
    try {
        // A directory (or a socket, or a fifo) is not an executable, and
        // spawning one to find out is a side effect we do not want.
        if (!statSync(candidate).isFile()) return false;
        accessSync(candidate, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

/** Identity key used to fold two spellings of the same binary (`google-chrome`
 * resolving onto `/usr/bin/google-chrome`) into one option. Falls back to the
 * path itself when `realpath` cannot resolve it. */
export function identity(candidate: string): string {
    try {
        return realpathSync(candidate);
    } catch {
        return candidate;
    }
}
