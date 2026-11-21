import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// Every word on a GLOSSARY.md `_Avoid_:` line is banned from app/ code,
// identifiers and comments included. A word that is also an ordinary code
// word goes in ALLOWED_IN_CODE with the reason.

const ROOT = join(__dirname, "..", "..");
const APP = join(ROOT, "app");

// Vendored shadcn/ui components: not our language.
const SKIPPED_DIRS = [join(APP, "components", "ui")];

const ALLOWED_IN_CODE: Record<string, string> = {
  user: "the users table, UserRole and auth helpers",
  admin: "UserRole.Admin and admin routes",
  "the team": "ordinary English",
  staff: "isStaff, the Instructor-or-Admin permission",
  access: "content access (requireContentAccess)",
  progress: "lesson progress tracking",
  author: "a Discussion Question's author",
  question: "quiz questions",
  thread: "ordinary English",
  reply: "ordinary English",
  answer: "quiz answers",
  order: "sort order and orderBy",
  transaction: "database transactions",
  code: "Seat redemption codes and source code",
  coupon: "the coupons table behind Seats",
  refund: "the Refund term itself",
  pending: "pending UI states",
  requested: "ordinary English",
  completed: "lesson completion",
  alert: "the Alert UI component",
  message: "error messages",
  activity: "ordinary English",
  star: "ordinary English",
  comment: "the comments table behind Discussion Questions and Replies",
  memo: "React's useMemo",
  "team purchase":
    "known drift: createTeamPurchase and the confirm-team-purchase intent predate the Team Licence term",
};

type AvoidWord = { word: string; term: string };

function readAvoidWords(): AvoidWord[] {
  const lines = readFileSync(join(ROOT, "GLOSSARY.md"), "utf8").split("\n");
  const words: AvoidWord[] = [];
  let term = "";
  for (const line of lines) {
    const heading = line.match(/^\*\*(.+)\*\*:/);
    if (heading) term = heading[1];
    const avoid = line.match(/^_Avoid_:\s*(.+)$/);
    if (!avoid) continue;
    for (const raw of avoid[1].split(",")) {
      const word = raw.replace(/\(.*?\)/g, "").trim().toLowerCase();
      if (word) words.push({ word, term });
    }
  }
  return words;
}

function sourceFiles(dir: string): string[] {
  if (SKIPPED_DIRS.includes(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

// "addLearner" → "add learner", so camelCase identifiers match too.
function toWords(line: string): string {
  return line.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("GLOSSARY.md avoid-list", () => {
  it("finds avoid-words to check", () => {
    expect(readAvoidWords().length).toBeGreaterThan(0);
  });

  it("keeps every avoid-word out of app/", () => {
    const banned = readAvoidWords()
      .filter(({ word }) => !(word in ALLOWED_IN_CODE))
      .map(({ word, term }) => ({
        term,
        word,
        pattern: new RegExp(
          `\\b${escapeRegExp(word).replace(/ /g, "[\\s_-]*")}s?\\b`,
        ),
      }));

    const hits: string[] = [];
    for (const file of sourceFiles(APP)) {
      if (file === __filename) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const words = toWords(line);
          for (const { word, term, pattern } of banned) {
            if (pattern.test(words)) {
              hits.push(
                `${relative(ROOT, file)}:${i + 1}  "${word}" → use "${term}"`,
              );
            }
          }
        });
    }

    expect(
      hits,
      "Use the GLOSSARY.md term. If the word is an ordinary code word here, add it to ALLOWED_IN_CODE with the reason.",
    ).toEqual([]);
  });
});
