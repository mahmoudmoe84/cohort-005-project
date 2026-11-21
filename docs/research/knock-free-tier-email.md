# Does Knock's free tier send email itself?

Research for issue #21 ("Does Knock's free tier send email itself?"). Sources were read on 2026-11-15. Each claim cites the vendor's own docs or pricing page. Where a page did not say something, this file says "not stated".

## Answer

**No. On the free plan, Knock's built-in email only sends test mail to members of the Knock account. To email real learners, Cadence must connect its own provider. Postmark is supported.**

- Knock's built-in email channel is "for testing only" [K1].
- It only delivers to email addresses of members of your Knock account. Other addresses fail with `knock_recipient_not_allowed` [K1].
- It is capped at 100 emails per month [K1].
- Postmark is a supported provider. It needs a Postmark API key and a from address [K2][K3].
- The free plan includes up to 10,000 messages sent per month, with unlimited workflows and environments [K4].
- An in-app message plus an email to one recipient counts as two messages [K4][K5].

## The built-in test email

- Knock says: "Knock comes with a built-in email channel to test your email notifications" [K1].
- Asked whether it can be used in production, the FAQ says: "No. This provider is for testing only" [K1].
- The email overview lists it as "Knock (testing only)" [K3].
- Recipients: sends only go to addresses that belong to members of your Knock account. Other addresses fail with a delivery error (`knock_recipient_not_allowed`) [K1].
- Cap: "You can send up to 100 emails per month for free" [K1]. Over the cap, emails are marked `undelivered` and not sent. Sending resumes at the start of the next month [K1].
- Environments: it is on by default "across all environments" for new accounts [K1]. Inference: it runs in a production environment too, but the recipient rule still blocks real learners there.
- From address: the channel has a read-only "From email address" setting. The page does not say which address it uses [K1].
- Whether the test channel depends on the plan: not stated [K1].
- Whether test-channel sends count toward the 10,000 messages per month: not stated.

## Free-tier caps

The plan is now called "Free". Knock's docs say it was "formerly known as our Developer plan" [K5]. The pricing page lists [K4]:

- Messages sent: "up to 10,000" per month.
- Workflows: unlimited.
- Environments: unlimited. "Create as many environments as you need to map to your development lifecycle."
- Team members (seats): unlimited. A team member is "anyone with login access to your account."
- Delivery channels: unlimited.
- Knock branding: "Remove Knock branding" is "No" on Free. Which surfaces show the branding: not stated.
- Log retention: "30-day retention".
- In-app feed retention: unlimited, "No limit, but can be configured."
- Email client previews: not included on Free.
- Guide recipients: up to 500. Agent credits: up to 500.
- Over the limit: "We don't hard cap your messages." Knock will contact you about setting up billing [K4].
- Knock does not pay downstream providers. You still pay providers such as Postmark directly [K4].

## How messages are counted

- Knock's definition: "A message is counted each time a notification is successfully delivered to a single user on a single channel" [K5].
- The pricing page says the same: "A single message delivered to a single user on a single channel." Messages that bounce or fail to send are not included [K4].
- Our case, stated directly: "A workflow that notifies a user by both email and in-app results in two messages" [K5].
- Workflow runs are not billed: "We only charge for messages sent, not messaging workflows triggered within Knock" [K4].
- A channel step that is skipped (for example by user preferences) creates no message [K5].
- Sandbox mode: "Sandboxed messages are rendered for preview in the Knock dashboard, but do not count toward usage" [K5].
- Non-production environments are not excluded. Knock recommends sandbox mode or channel conditions to avoid usage from testing [K5].

Inference: each Notification that reaches a learner both in-app and by email uses 2 of the 10,000 free messages. So the free plan covers at most about 5,000 such Notifications per month.

## If we bring our own provider

### Postmark

Connected per environment, on the channel's Settings tab [K2]:

- **API key** (required): "The API key for your Postmark server."
- **From email address** (required): "The default sender email address (can use Liquid tags)."
- **Incoming webhook** (optional): receives delivery status updates from Postmark.
- Optional overrides: from name, reply-to, to/cc/bcc, and payload overrides.
- Optional advanced settings: sandbox mode, Knock or Postmark open and link tracking, CSS inlining.
- Message stream: there is no stream field. Knock targets no stream, so Postmark uses the default "outbound" transactional stream. A payload override such as `{"MessageStream": "broadcasts"}` picks another stream [K2].
- Delivery tracking needs a verified sender signature or domain in Postmark. You add Knock's webhook URL in Postmark and select the Delivery, Bounce, and Spam complaint events [K2].

Inference: Cadence can reuse its existing Postmark server token and verified sender. Knock does not require a separate Postmark server or stream for Notifications.

### Other supported providers

Listed on the email overview [K3]: Amazon SES, Cloudflare Email, MailerSend, Mailgun, Mailjet, Mailtrap, Mandrill, Postmark, Resend, SendGrid, SMTP, SparkPost, and Knock (testing only).

## Not verified

- Whether emails sent through the built-in test channel count toward the 10,000 messages per month.
- Whether the test channel's 100-per-month cap differs on paid plans.
- Which surfaces show Knock branding on the free plan (for example the in-app feed or emails).
- Whether a retried send counts more than once.
- What "successfully delivered" means for an in-app message. These pages do not say.

## Sources

- [K1] https://docs.knock.app/integrations/email/knock-test
- [K2] https://docs.knock.app/integrations/email/postmark
- [K3] https://docs.knock.app/integrations/email/overview
- [K4] https://knock.app/pricing
- [K5] https://docs.knock.app/manage-your-account/knock-plans
