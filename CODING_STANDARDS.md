# Coding standards

## Fail with a thrown response, not a return value

A loader or an action that cannot continue throws. It does not return an
error shape for the component to unpack.

```ts
if (!course) throw data("Course not found", { status: 404 });
```

The route then has one success path. A returned error shape gives every
component a second path to forget about.

## Parse untrusted input with a schema

Form data, search parameters and request bodies get a zod schema before the
values reach any query. Do not read `formData.get("x") as string`. The cast
is a lie the type checker believes.

## Do not write `any`, and do not write `!`

Both switch the type checker off at the exact point you are least sure. If a
value can be missing, narrow it with a check. If you cannot name the type,
the shape is wrong — fix the shape.

## Let the code explain itself

Name and extract until a comment is unnecessary. A comment earns its place
only for a _why_ the code cannot express: a constraint, a decision, a link to
the ADR behind it. A comment that restates _what_ the code does goes stale the
first time the code changes.

## Reach the database through a module, not from a route

A route parses the request, checks who is asking, and calls a module in
`app/modules/`. Once a route's queries have moved into a module, the route
does not import `~/db`, `~/db/schema`, `drizzle-orm` or `better-sqlite3`
again. A new query goes into the module behind its entry point.

```ts
// app/routes/instructor.analytics.tsx
import { getInstructorAnalytics } from "~/modules/instructor-analytics/index.server";
```

Import a module only through its root files, never from its `lib/` or
`tests/` (see [app/modules/README.md](./app/modules/README.md)). A module's
browser-safe entry point, such as `instructor-analytics/config.ts`, never
imports the database either: the page bundles it for the browser.

`npm run lint:boundaries` enforces this for the analytics page
(`analytics-page-no-database`). When you move another route's queries into a
module, add that route to the same rule in `.dependency-cruiser.cjs`.

## Arrange tests through the module under test

Test setup calls the module's own functions. When the function you need does
not exist, add it to the module rather than inserting rows directly, so a
change to how the module stores its data leaves its tests alone.
