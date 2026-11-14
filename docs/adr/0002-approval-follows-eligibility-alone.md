---
status: accepted
---

# Approval follows eligibility alone, and the screen suggests but never blocks

An admin approves every refund request whose purchase is eligible ([ADR-0001](0001-refund-eligibility-judged-at-two-moments.md)), whatever reason the student gave. They decline only when it is not eligible. Admins must not invent their own criteria, and students pick reasons almost at random ("I got what I needed" from someone well within the limits), so judging the reason would make decisions arbitrary. Even so, the screen only *suggests*: each card shows a verdict ("Eligible" / "Not eligible: watched 2h 05m, over the 2-hour limit"), but Approve and Decline are never disabled. We trust the admin to make the final call.

## Considered Options

- **Admins also judge the reason, and may decline an eligible request.** Rejected: the reason is not a reliable signal, and it lets each admin set their own policy. Repeat misuse (a student refunded on course after course) is handled by a rule instead ([ADR-0003](0003-one-refund-per-student-ever.md)).
- **The screen enforces the verdict by disabling Approve on an ineligible request.** Rejected: we trust the admin, and leave room for cases the rules do not foresee.

## Consequences

- **Declined is final.** An admin declines only an ineligible purchase. Time watched and lessons completed only ever go up, and the refund window only closes, so a declined purchase can never become eligible again. The student cannot send another refund request for it.
- Do not "fix" the verdict by wiring it to the buttons. Leaving them enabled is deliberate.
- Refunding outside this process (for example, to calm a student complaining publicly) is parked. When it is picked up it will need its own ADR, because it breaks this one and the glossary's rule that a refund request is the only way a purchase is undone.
