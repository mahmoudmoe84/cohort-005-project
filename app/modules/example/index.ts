// A copy-me template for a deep module. Copy this folder, rename it, or
// delete it. This root file is an entry point: outside code imports it, and
// nothing in `lib/` or `tests/`.

import { countWords } from "./lib/impl";

/** How long a piece of text takes to read, in whole minutes (at least 1). */
export function readingMinutes(text: string): number {
  return Math.max(1, Math.ceil(countWords(text) / 200));
}
