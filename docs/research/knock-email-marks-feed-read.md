# Can a Notification's email mark it read in the Notification Feed?

Research for issue #22. Sources were read on 2026-11-20. Each claim cites the vendor's own docs or pricing page. Where a page did not say something, this file says "not stated". Lines marked **Inference** are my reading, not a quote.

## Answer

**Not by itself. Knock tracks engagement per message, so an email open or click only marks the email message. Nothing in Knock's docs copies that status onto the feed message. Cadence can still do it with one extra API call, and the cleanest way is on Cadence's side: when the person lands on the Refund Request or Discussion page, Cadence marks that Notification read through its `NotificationProvider`. It costs no extra messages.**

- A Knock message is one notification to one recipient on one channel, and its engagement statuses belong to that message [K1].
- Knock open tracking sets `read` on the email message. Knock link tracking sets `link_clicked` on the email message [K1][K2].
- No Knock doc page describes a status on one channel carrying over to another channel's message in the same workflow run [K1][K2]. Not stated anywhere I read.
- Knock's Messages API can mark any message read: `PUT /v1/messages/{message_id}/read`, `POST /v1/messages/batch/read`, or the bulk channel endpoint [K3][K4].
- Status updates are not "messages sent", so they don't count toward the free plan's 10,000 per month [K5]. The pricing page doesn't mention API calls directly.
- Email opens are unreliable. Apple Mail Privacy Protection triggers false opens, and clients that block images record no open [P1][P2].

## 1. Engagement statuses are per message (per channel)

- Knock's statuses are `seen`, `read`, `link_clicked`, `interacted`, `archived`. They are "mutually inclusive", so one message can hold several at once [K1].
- A Message is "a notification delivered to a recipient on a particular channel" [K1]. A Refund Request decision sent in-app and by email is two messages with separate statuses.
- Email: Knock sets `read` only if Knock open tracking is on, and `link_clicked` only if Knock link tracking is on [K1].
- In-app feed: Knock manages `seen`, `interacted`, `archived`. `read` is set by Knock's feed SDK when the client marks it read. A click on the action URL is recorded as `interacted` [K1].
- Statuses can also be set "via the Knock API" [K1].
- Cross-channel: the message statuses page and the tracking page say nothing about an email status propagating to the feed message [K1][K2]. **Inference:** it does not happen; Cadence must do it.
- The badge uses the feed's aggregate counts. The feed API "Returns aggregate values for unread counts, read counts, and seen counts, for use in feed badge UIs" [K6]. So marking the feed message `read` takes it off the bell.
- Whether a status change made through the API reaches an open bell in real time: not stated. The feed overview only says the websocket receives notice "when new messages are sent" [K6].

Knock's own cross-channel feature runs the other way. A step condition can send the email only if the in-app message "has not been seen" after a delay [K7]. Message status conditions exist only at step level, and a condition on an expired message always evaluates false [K7][K8]. That avoids a duplicate email; it doesn't mark the feed message read.

## 2. Knock tracking vs Postmark tracking

- Knock tracking is "opt-in, provider-agnostic". Link tracking rewrites links to a Knock domain (e.g. `c1.knock.app`). Knock "will record a link-click event before redirecting the user". Open tracking embeds an image in the email footer [K2].
- Both toggles sit under the channel's **Advanced** settings, per environment, and "will always default to `OFF`". Workflow steps can override them [K2].
- Provider tracking is separate. Native provider tracking "will not report back to Knock and do not enable the same functionality" [K2].
- Knock's Postmark channel has four separate toggles: "Postmark email-open tracking", "Postmark link-click tracking", "Knock email-open tracking", "Knock link-click tracking" [K9].
- The Postmark incoming webhook to Knock carries delivery status only. Delivery events set `delivered`, Bounce events set `bounced`, and complaints are recorded as `message.complaint` [K9]. Opens and clicks are not listed. **Inference:** turning on Postmark's own tracking does nothing for the feed. Only Knock's tracking toggles matter.
- Knock's outbound webhooks include `message.read`, `message.link_clicked`, `message.seen` and `message.interacted`. "`message.link_clicked` requires Knock link tracking to be enabled" [K10]. Which plans include outbound webhooks: not stated [K10][K5].
- The pricing page lists "Engagement tracking" ("Manage cross-channel open and link tracking from a single platform") as "Yes" on Free [K5].

## 3. Finding the feed message to mark

- Triggering a workflow returns only a `workflow_run_id` [K11].
- `GET /v1/messages` filters by `workflow_run_id`, `channel_id`, `trigger_data`, `engagement_status`, `source` (workflow key), `tenant` and more [K3].
- A message's `source` holds `workflow_run_id` and `workflow_recipient_run_id` [K3].
- `POST /v1/messages/batch/read` takes `{"message_ids": [...]}` [K3].
- `POST /v1/channels/{channel_id}/messages/bulk/{action}` updates many messages in one channel, filtered by `recipient_ids`, `workflows`, `trigger_data`, `engagement_status`, `tenants`, `older_than`/`newer_than`. It runs as an async `BulkOperation` [K4]. The page gives `archive` and `unarchive` as example actions and doesn't list them all [K4]. Whether `read` is a valid action: not confirmed from that page.

## 4. Options and what Cadence would set up

### Option A: Knock open tracking alone

- Set up: turn on "Knock email-open tracking" on the Postmark channel (or the email step) [K2][K9].
- Result: the **email** message gets `read`. The feed message stays unread [K1]. Doesn't solve the bell.

### Option B: Knock tracking plus an outbound webhook to Cadence

- Set up: turn on Knock link tracking (and optionally open tracking) on the email channel [K2]. Create a Knock outbound webhook for `message.link_clicked` (and/or `message.read`) pointing at a new Cadence route [K10]. The route reads the email message's `source.workflow_run_id`, lists feed messages for that run with `GET /v1/messages?workflow_run_id=…&channel_id=<feed>`, and calls `POST /v1/messages/batch/read` [K3].
- Costs: all links in the email go through a Knock redirect domain [K2]. Cadence must verify webhook signatures and expose a public endpoint. Using opens brings the false-open problem below. Free-plan access to outbound webhooks is not stated.
- Fit: the webhook payload and the run-to-feed lookup are Knock-shaped, so this adds a second Knock-specific surface outside `send`/`feedCredentials`.

### Option C: Cadence marks it read when the person arrives (recommended)

- Set up: no Knock tracking and no Postmark tracking. The email's link points straight at the Cadence page for the Refund Request or Discussion. When that page loads for the signed-in person, Cadence calls a new `NotificationProvider` method, for example `markRead(userId, ref)`.
- The Knock implementation of `markRead` finds that user's feed messages for the Notification and marks them read. Two ways, both from [K3][K4]:
  1. Store the `workflow_run_id` returned by `send` [K11] next to the Refund Request or Discussion Reply. Then `GET /v1/messages?workflow_run_id=…&channel_id=<feed>` and `POST /v1/messages/batch/read`.
  2. Or filter by `trigger_data`, which needs a Cadence reference id (Refund Request id or Discussion id) in the trigger data. That goes past the "only user ids and email addresses" preference, so option 1 fits better.
- Bonus: it also clears the bell when the person reaches the page any other way, not only from the email. **Inference:** that matches what "read" means to a learner better than an email open does.
- Optional: add a `?from=email` param for logging only. It isn't needed for the logic.
- Fit: one new method on the server interface. Nothing Knock-specific leaks into routes, and a different provider would implement the same `markRead`.

## 5. Free-plan message cost

- A message is "A single message delivered to a single user on a single channel". Bounced or failed messages are excluded [K5].
- "We only charge for messages sent, not messaging workflows triggered within Knock" [K5].
- Status updates, reads and other API calls: not stated on the pricing page [K5]. **Inference:** they deliver nothing to anyone, so they are not messages sent. Options A, B and C add zero messages.
- An outbound webhook delivery is not a notification to a user. Whether Knock counts it: not stated [K5][K10].

## 6. Email opens are unreliable

- Postmark: Apple's proxy fetching the pixel "will prompt a false-positive open event in Postmark", and "it is possible to see inflated open events from recipients using Apple Mail if a user turns on this feature" [P1].
- Postmark: "open tracking is not 100% accurate" [P1].
- Postmark: "If a user views emails in a client that blocks images from loading, Postmark can't track opens for those emails". It can only add a pixel to HTML emails [P2].
- Knock's open tracking also works by an image in the email footer [K2]. **Inference:** the same false opens and missed opens apply to Knock's open tracking. An open-driven mark would sometimes clear the bell for a Notification nobody read, and sometimes not clear it for one they did.

## Recommendation

Do it, with Option C. Mark the feed message read when the person lands on the Refund Request or Discussion page, through a new `markRead` method on `NotificationProvider`, keyed by the `workflow_run_id` Cadence stores from `send`. Don't rely on email opens. Skip Knock link tracking and outbound webhooks unless Cadence later wants click analytics. It costs no messages.

## Not verified

- That `read` is a valid `{action}` on the bulk channel endpoint [K4].
- Whether a status change made via the API updates an open bell in real time, or only on the next fetch [K6].
- Whether outbound webhooks are on the Free plan [K5][K10].
- Whether API status updates or webhook deliveries ever count toward usage. The pricing page doesn't say [K5].
- No live test was run against a Knock account.

## Sources

- [K1] Knock, Message statuses: https://docs.knock.app/send-notifications/message-statuses
- [K2] Knock, Tracking: https://docs.knock.app/send-notifications/tracking
- [K3] Knock API reference, Messages: https://docs.knock.app/api-reference/messages
- [K4] Knock API reference, Bulk update message status for channel: https://docs.knock.app/api-reference/channels/bulk/update_message_status
- [K5] Knock, Pricing: https://knock.app/pricing
- [K6] Knock, In-app feeds overview: https://docs.knock.app/in-app-ui/feeds/overview
- [K7] Knock, Step conditions: https://docs.knock.app/designing-workflows/step-conditions
- [K8] Knock, Conditions: https://docs.knock.app/concepts/conditions
- [K9] Knock, Postmark integration: https://docs.knock.app/integrations/email/postmark
- [K10] Knock, Outbound webhook event types: https://docs.knock.app/developer-tools/outbound-webhooks/event-types
- [K11] Knock API reference, Trigger workflow: https://docs.knock.app/api-reference/workflows/trigger
- [P1] Postmark, Open tracking and Apple Mail: https://postmarkapp.com/support/article/1257-open-tracking-and-apple-mail
- [P2] Postmark, Tracking opens: https://postmarkapp.com/developer/user-guide/tracking-opens
