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

## A new or changed glossary term is the user's decision

Flag every term the diff adds to or rewords in `GLOSSARY.md`, and every
word it removes from an `_Avoid_:` list, for the user to confirm. A term
added so that a name already in the code counts as defined is the code
renaming the domain: report it, and name the existing term the code should
use instead.
