/**
 * Windows Chrome run — the raw machine seams: a TCP reachability sample and a
 * direct interop launch.
 *
 * The two halves of the run that reach outside the process, injected by
 * ./run.ts (and replaced wholesale by the tests) so a unit run never opens a
 * real socket or spawns through the interop mount. The TCP sample answers
 * reachable only on a genuine connect — a refusal or a timeout both read
 * unreachable, the honest NAT-host behaviour. The launch is the interop exec of
 * the located executable (NOT the `cmd.exe /c start` wrapper the plan quoted:
 * under interop that wrapper never returns while the GUI browser lives, so the
 * whole run silently stalls — measured 2026-10-06 against Chrome 154), resolving
 * the moment the OS accepts the process.
 */
import { spawn } from "node:child_process";
import { connect } from "node:net";

import { WINDOWS_CHROME_SAMPLE_MS } from "../constants.js";

/** One TCP sample: connect success answers reachable; anything else (refusal,
 * timeout) answers unreachable — the NAT host's honest behaviour. */
export function defaultReachable(host: string, port: number, sampleMs: number = WINDOWS_CHROME_SAMPLE_MS): Promise<boolean> {
    return new Promise((resolve) => {
        let settled = false;
        const socket = connect({ host, port });
        const finish = (value: boolean) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(value);
        };
        socket.setTimeout(sampleMs);
        socket.on("connect", () => finish(true));
        socket.on("timeout", () => finish(false));
        socket.on("error", () => finish(false));
    });
}

/**
 * Launch the Windows-side browser through the interop mount by exec'ing it
 * directly, resolving the moment the OS accepted the process (the browser
 * itself keeps running — the run must never wait for it, and the port wait
 * below is what turns a silently dead launch into `unreachable`).
 *
 * The interop `start` wrapper is deliberately NOT used here even though the
 * plan quoted `cmd.exe /c start`: measured 2026-10-06 against Windows Chrome
 * 154 (see .probe/windows-chrome-connect-probe.log), the WSL interop process
 * for `cmd.exe /c start "" <browser> <args…>` does not exit while the GUI
 * browser lives, so step 4 could never report its answer and the card sat in
 * "launching" until the spawn timed out — a silent 30 s. A direct
 * `execve`/CreateProcess of the executable accepted in 3 ms and bound the
 * port in ~1 s; this is the only launch shape that returns. It also keeps
 * Chrome's working directory out of any UNC path (the old `start` warning),
 * since the launch takes a Windows-side cwd.
 */
export function defaultStart(executable: string, args: string[], cwd: string | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
        let child: ReturnType<typeof spawn>;
        try {
            child = spawn(executable, args, {
                stdio: "ignore",
                ...(cwd === undefined || cwd === "" ? {} : { cwd })
            });
        } catch (error) {
            reject(new Error(`could not run "${executable} ${args.join(" ")}": ${String(error)}`));
            return;
        }
        // `spawn` is the OS accepting the process; no other half is waited on.
        child.once("spawn", resolve);
        child.once("error", (error: NodeJS.ErrnoException) =>
            reject(new Error(`could not run "${executable} ${args.join(" ")}": ${String(error)}`)));
        child.unref();
    });
}
