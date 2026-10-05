/**
 * Windows Chrome run — the workspace `.chrome` view link.
 *
 * A run profiles a Windows-native directory and keeps the checkout's `.chrome`
 * as a **view** of it: a WSL-side symlink, so Windows never sees the link, but
 * the checkout reads the profile back through it. A real directory already
 * sitting at the view spot is kept — the link never clobbers what is already
 * there. The answer names what happened (`linked`/`updated`/`kept`/`failed`) so
 * the controller states a kept directory exactly once.
 */
import { lstatSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";

import { windowsPathToMount } from "./paths.js";
import type { WindowsChromeLinkAnswer } from "../types/index.js";

/**
 * Points `linkPath` (the workspace's `.chrome`, a WSL-side path) at the
 * Windows-side profile directory — the link is pure WSL-side, so Windows never
 * sees it, but everything the run profiles reads back from the checkout. The
 * target is Linux-side (`/mnt/c…`): Chrome reads the Windows spelling of the
 * link's own target, not this link at all. A real directory that is already
 * there is kept untouched (it might carry the user's own reading).
 */
export function linkWindowsChromeProfile(linkPath: unknown, profileWin: unknown): WindowsChromeLinkAnswer {
    const link = typeof linkPath === "string" ? linkPath.trim().replace(/[\\/]+$/u, "") : "";
    const target = windowsPathToMount(profileWin);
    if (link === "" || target === "") return "failed";
    let existing: ReturnType<typeof lstatSync>;
    try {
        existing = lstatSync(link);
    } catch {
        try {
            symlinkSync(target, link);
            return "linked";
        } catch {
            return "failed";
        }
    }
    if (!existing.isSymbolicLink()) return "kept";
    if (readlinkSync(link) === target) return "updated";
    try {
        unlinkSync(link);
        symlinkSync(target, link);
        return "updated";
    } catch {
        return "failed";
    }
}
