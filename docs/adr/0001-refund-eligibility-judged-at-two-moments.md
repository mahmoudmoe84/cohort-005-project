---
status: accepted
---

# Refund eligibility is judged at two moments

A student keeps access to a course while their refund request is in the requested status, so the purchase can stop being eligible between the day they ask and the day an admin decides. We judge the refund window on the day the refund request is sent, and judge time watched and lessons completed again when the admin decides. That way a slow review never costs the student, but watching after asking counts against them. This means the numbers have to be saved at the moment the request is sent, because they cannot be worked out again afterwards.

## Considered Options

These scenarios settled it:

| | What happens | Judged when sent | Judged when decided |
|---|---|---|---|
| A | Bought 1 Nov, asks on 15 Nov (the last day), the admin reviews on 17 Nov | Approve | Decline (window passed) |
| B | Asks on day 3 with 30m watched, then watches 3h before the review | Approve | Decline (watched too much) |
| C | Asks with 1h 50m watched, finishes the lesson they were on and reaches 2h 05m | Approve | Decline (just over) |
| D | Asks on day 2, and the admin reviews the same day | Approve | Approve |

- **Everything judged when the request is sent.** Rejected: B gets a refund after watching most of the course.
- **Everything judged when the admin decides.** Rejected: in A the student pays for our slow review.
- **Access paused while the request waits.** Rejected: a student who is later declined loses days of access they paid for. It was the strongest alternative, so it is worth revisiting if binge-after-asking turns out to be common.
- **Window when sent, progress when decided (chosen).** It handles A and B. C is declined, and we accepted that: the limit is the limit, and the card shows the admin the exact numbers.

## Consequences

- The admin card shows both columns, "when requested" and "now", so the admin can see what changed while the request waited.
- The Refund Policy does not mention that watching after asking counts ([ADR-0004](0004-refund-policy-states-only-four-limits.md)).
