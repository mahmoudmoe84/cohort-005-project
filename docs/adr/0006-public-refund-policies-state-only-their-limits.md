---
status: accepted
---

# The public refund policies state only their limits

Supersedes [ADR-0004](0004-refund-policy-states-only-four-limits.md).

There are two public policies, both readable before buying. The Individual Refund Policy says only four things: refunds are available for 15 days counting the purchase day, with under 2 hours watched, under half the lessons completed, and one refund per student. The Team Refund Policy states the team purchase rule ([ADR-0005](0005-claimed-team-seat-blocks-whole-team-purchase-refund.md)), because a team admin needs it before handing out any team seat. Both deliberately leave out the finer rules: watching after asking still counts ([ADR-0001](0001-refund-eligibility-judged-at-two-moments.md)), and progress is kept after a refund ([ADR-0003](0003-one-refund-per-student-ever.md)). Spelling out every edge teaches people how to game the rules, and once detail is published it cannot be taken back. Neither says anything about how platform admins review refund requests.

## Considered Options

- **A complete policy that lists every rule.** Rejected: it trades a little transparency for a guide to misuse.
- **Keep the team purchase rule private, like the finer individual rules.** Rejected: unlike those, a team admin acts on it (handing out the first team seat ends refund eligibility), so hiding it would trap them.

## Consequences

- Do not "complete" either page by adding the missing rules. They were left out on purpose.
