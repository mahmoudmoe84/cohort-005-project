# The Notification Provider sits behind Cadence's own interface

Cadence uses Knock as its Notification Provider, but we want to be able to replace it on price or features by writing one new adapter and changing nothing else. So no Cadence code imports Knock outside two adapter files. Instead it uses two interfaces that Cadence owns, modelled on `MailTransport` in `app/lib/mailer.server.ts`:

- **Server: `NotificationProvider`.** It has two methods. `send({ kind, recipients: [{ id, email }], actor, content })` sends one Notification, and the provider registers each recipient from the send itself, so there is no separate call for that. `feedCredentials(userId)` returns a blob the browser adapter needs to connect (for Knock: the signed user token, the public key and the feed channel id). Cadence's code never reads inside it.
- **Browser: `NotificationFeedClient`.** It has six methods: `fetchPage(cursor?)` → `{ notifications, nextCursor }`, `unreadCount`, `markRead(id)`, `markAllRead()`, `onArrival(callback)` and `disconnect()`. The Knock adapter uses Knock's headless JS client and connects to Knock directly. It returns Cadence's own `Notification` type (`id`, `kind`, `actor`, `summary`, `excerpt`, `context`, `url`, `insertedAt`, `readAt`), not Knock's feed item. The component that provides the feed is keyed on the current person's id, so a DevUI user switch disconnects the old client and builds a new one.

The decisions that keep the provider replaceable:

- **Cadence writes all the wording.** Cadence writes each Notification's text, link and email subject and body from its kind and data, and sends the provider finished text. Knock's templates only print the fields they are given, so a swap leaves no messages behind and the wording can be unit-tested.
- **The switch lives in Cadence's database.** The provider never sees it. When the switch is off, Cadence asks for in-app only, unless the kind is Refund Request decided. The browser reads the switch from loader data to decide whether to show the live pop-up.
- **Mapping kinds is the adapter's job.** Cadence owns the list of kinds. The Knock adapter maps each kind to its own Knock workflow, so grouping can be added per kind later.
- **A failed send never blocks the action that caused it.** `send` logs the error and returns, and the action still succeeds. Nothing is retried or queued.
- **Dev and tests use a fake.** When `KNOCK_API_KEY` is unset, a fake provider stores Notifications in memory, and email it is asked for goes to `.outbox/`. A fake browser client polls a dev-only Cadence route, so the bell works with no Knock account.

## Considered Options

- **The browser only talks to Cadence, and the server proxies the feed.** Rejected: live arrivals would need Cadence to run its own push channel (for example SSE) and to find out about new arrivals itself, which is a relay we don't otherwise need.
- **Knock's ready-made React components and dashboard templates.** Rejected: both would leave UI and wording stranded at Knock when we swap.

## Consequences

Knock's dashboard can't be used to edit Notification wording. If Knock groups several Notifications into one, the text for the group ("3 new Discussion Questions") would have to be written by Knock's template, which goes against Cadence writing all the wording. That question is left for the decision on grouping.
