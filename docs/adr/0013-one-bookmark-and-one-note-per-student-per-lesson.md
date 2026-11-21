# One Bookmark and one Note per Student per Lesson, enforced by the database

A Student has at most one Bookmark and at most one Note on a Lesson. Toggling a Bookmark adds or removes that one row, and saving a Note again replaces its body and moves its "last edited" time on. A unique index on (user, Lesson) in both tables holds the rule, not a check in application code, so two requests racing each other cannot create a second row.
