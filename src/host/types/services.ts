/**
 * Structural views of the host services this half registers onto but does not
 * own. The slash-command shapes come from the `commands` service — the headless
 * mirror surface the card's two executable actions get; the service may be
 * mounted after `apply` returns (hence the lazy injection) and may not be
 * mounted at all on a host with no commands plane.
 */

/** One slash-command invocation: the raw text after the command name. */
export type CommandInvocation = { rawInput: string };

/** What a slash-command handler answers with — never thrown, always shown. */
export type CommandResult = { kind: "success" | "error"; text: string };

/** The `commands` service definition shape, registered by name. */
export type CommandDefinition = {
    name: string;
    description: string;
    input?: { hint?: string };
    handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
};
