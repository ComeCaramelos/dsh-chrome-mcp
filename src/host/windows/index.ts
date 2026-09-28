/**
 * Host half — the Windows-side Chrome run behind the card's **Open Windows
 * Chrome** button and the `prelaunch_windows_chrome` tool.
 *
 * The whole Windows path, split the way it reads into one directory:
 *
 *   ./paths.ts          drive→mount mapping, locate, the Windows-native profile
 *                      directory + LOCALAPPDATA root, and the project dir the
 *                      workspace `.chrome` view hangs under
 *   ./link.ts           the workspace `.chrome` view link (a WSL-side symlink)
 *   ./connect-flags.ts  the connect address + the replace-by-key `--browserUrl`
 *                      merge with the local profile flag dropped
 *   ./landing.ts        the packaged page the launched window opens, rendered
 *                      with the run's answers, written beside the profile and
 *                      answered back as a `file:///…` URL
 *   ./spawn.ts          the raw TCP reachability sample + the interop launch
 *   ./run.ts            the orchestrator: locate → prereq → port → launch → wait
 *
 * Driving the Windows browser in **connect** mode is the only Windows path ever
 * measured to work (launching `chrome.exe` across the interop boundary cannot —
 * the debug pipes do not survive it); see ./run.ts's header and the field log in
 * `.probe/windows-chrome-connect-probe.log`. Every half is injectable, so the
 * tests never depend on the machine they run on.
 */
export {
    findWindowsChromeExecutable,
    windowsChromeLocalAppData,
    windowsChromeProfileDir,
    windowsChromeProjectDir,
    windowsPathToMount
} from "./paths.js";
export { linkWindowsChromeProfile } from "./link.js";
export { browserUrlFlagPort, withBrowserUrlFlag, windowsChromeUrl } from "./connect-flags.js";
export { windowsChromeLandingAsset, windowsChromeLandingHtml, windowsChromeLandingPath, windowsChromeLandingUrl, windowsFileUrl } from "./landing.js";
export { runWindowsChromeConnect } from "./run.js";
export type { WindowsChromeRunOptions } from "./run.js";
