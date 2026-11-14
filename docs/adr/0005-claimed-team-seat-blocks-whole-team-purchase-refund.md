---
status: accepted
---

# A team purchase is refunded whole, and only until its first team seat is claimed

A team purchase is one purchase, so it gets one refund or none. Only the team admin who bought it can send a refund request, within the same refund window as an individual purchase. It stays eligible only until any of its team seats is claimed, even if the other seats are still unclaimed. The watching limits do not apply, because the team admin is not enrolled and nobody has watched while no seat is claimed. A team refund does not use up the team admin's one refund ([ADR-0003](0003-one-refund-per-student-ever.md)): that rule stops a person watching and being refunded again and again, which cannot happen before any seat is claimed. A student who claims a team seat has no purchase of their own and can never send a refund request.

This follows Coursera for Teams and Udacity: only the buyer can ask, the whole order is refunded or nothing is, there are no partial refunds, and seat holders never get refunds themselves.

## Considered Options

- **Refund the unclaimed team seats only.** Rejected: it needs a partial refund, which no other purchase has, and it lets a team admin buy a large batch, hand out a few seats, and get most of the money back.
- **Refund the whole team purchase and take back the claimed seats.** Rejected: it removes access from students who did nothing wrong.
- **A shorter window for teams.** Rejected: one refund window everywhere is easier to state and to trust.
- **Count a team refund against the team admin's one refund.** Rejected: it would punish a buyer who changed their mind before anyone watched.

## Consequences

- The Team Refund Policy states this rule publicly ([ADR-0006](0006-public-refund-policies-state-only-their-limits.md)): team buyers need it before handing out any seat.
