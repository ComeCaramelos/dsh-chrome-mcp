/**
 * Locale dictionaries registered on the shell locale service.
 *
 * One dictionary per tag; `en` is the fallback every other tag resolves
 * missing keys through, so it must always be present.
 */
import { en } from "./en-US.js";

/** tag → dictionary. Registered wholesale under the plugin's locale namespace. */
export const DICTIONARIES: Record<string, Record<string, string>> = { en };

/** Every tag this half registers; the first entry is the fallback. */
export const TAGS = ["en"];
