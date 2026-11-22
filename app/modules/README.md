# Modules

Each folder here is a **deep module**: a lot of behaviour behind a small interface. Its public surface is its **entry points**, meaning the files at the module root. Everything in a subfolder is private.

```
app/modules/
  <name>/
    index.ts          ← an entry point. Import this from outside.
    index.server.ts   ← another entry point. A module may expose several.
    lib/              ← implementation. Hidden from outside; free to import each other.
    tests/            ← tests and fixtures. Private, like lib/.
```

Copy `example/` to start a new module.

**Import only through a module's entry points.** Write `~/modules/instructor-analytics/config`, never `~/modules/instructor-analytics/lib/scope`. If outside code needs something from `lib/`, give it a root file as a new entry point. Don't reach in.

**No barrel files.** Don't make one `index.ts` that re-exports a whole subtree. Expose several small entry points that each say what they're for, like `instructor-analytics/config.ts` (safe in the browser) next to `instructor-analytics/index.server.ts` (queries the database).

## Rules

Run `npm run lint:boundaries` to check them. The config lives in `.dependency-cruiser.cjs`.

**Entry-point boundary.** Code outside a module, whether app code or another module, may import only that module's root files, never anything in its subfolders.

**Intra-module freedom.** A module's own files import each other freely.

**Tests through the entry points.** Files under `<module>/tests/` may import any module's entry points and their own `tests/` fixtures. They may not import any module's subfolder internals, including their own.

**No cycles.** No dependency cycles, anywhere under `app/`.

Beyond these four, `.dependency-cruiser.cjs` holds rules for specific modules. **`analytics-page-no-database`:** `app/routes/instructor.analytics.tsx` and `instructor-analytics/config.ts` may not import `~/db`, `drizzle-orm` or `better-sqlite3`. The page gets its data only through `instructor-analytics/index.server.ts`. **`routes-no-session`:** files in `app/routes/` may not import `~/lib/session`. Only `api.switch-user.ts`, `api.logout.ts`, `api.set-dev-country.ts`, `login.tsx` and `signup.tsx` may import it, because they write the session. A route gets the signed-in user only through `course-access/index.server.ts`.

Modules are flat: one level of folders under `app/modules/`. A module's internals may nest as deep as needed, but a module may not contain another module.
