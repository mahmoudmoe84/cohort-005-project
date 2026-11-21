# Does Novu Cloud's free tier send email itself?

Research for issue #19. It follows up on the vendor pick in `docs/research/notification-vendor.md` (branch `research/notification-vendor`). Sources were read on 2026-11-15. Each claim cites the vendor's own docs or pricing page. Where a page did not say something, this file says "not stated".

## Answer

**Only for testing. For real users, Cadence has to bring its own email provider.**

- Novu Cloud environments come with a **demo email integration** that is set as primary by default [N1].
- It is capped at **300 emails a month**, and it **only delivers to the email address of the logged-in Novu account**. "It does not deliver messages to any other email address." [N1]
- So it works for checking our own workflows in development. It cannot send Notification emails to learners or instructors. Novu's integrations page offers it only "to send a test before you connect a provider" [N2].
- **The free tier allows 5 workflows** [N3][N4]. A workflow can chain in-app and email steps [N5], and the workflow is the unit that gets counted. **One workflow with both an in-app step and an email step counts as one workflow toward the cap.** Each trigger for one subscriber is billed as **one workflow run**, however many steps run [N6][N7].

## Novu's built-in demo email

| | What the docs say |
|---|---|
| Exists? | Yes. "Your environments come pre-configured with two demo email integrations and two demo SMS integrations", set as primary by default [N1] |
| Monthly cap | "Both the demo email and demo SMS integrations are limited to 300 notifications per month each." [N1] |
| Who can receive | "Can only send emails to the address associated with your logged-in Novu account" [N1] |
| Where it works | "Only available in Novu cloud". Not in the community self-hosted version or a local environment [N1] |
| Dev or Prod only? | Not stated. The page says "your environments", meaning every environment. The recipient limit makes it useless for production anyway |
| Sender address | Not stated |

## Free-tier caps that matter

- **$0, no credit card. 10,000 workflow runs a month. Up to 5 workflows. 2 environments (Dev and Prod). All channels, including email and in-app.** [N3]
- The limits page lists **Free: 5 workflows** (Pro 20, Team 100), and **20 steps per workflow** on every plan. "Exceeding the default limit may result in restricted functionality or errors." [N4]
- The pricing page does not say whether an email provider is included. The demo integration page answers that question (see above).

### How workflows and runs are counted

- **Workflow:** "An environment-scoped orchestration definition that determines what to send, when, and on which channels." [N7] Steps are chainable, for example an in-app step, then a 24h delay, then an email step [N5]. The cap counts workflows, not steps or channels [N4]. So **in-app plus email in one workflow uses 1 of the 5**.
- **Workflow run:** "A single execution of a workflow for one subscriber" [N7]. "If a workflow is triggered to a subscriber, then it is billed as 1 event (one workflow run)." A trigger to 15 subscribers is billed as 15 runs [N6].
- Runs are **still billed** when preferences or step conditions skip a step, because "the workflow run is already created; only delivery or individual steps are skipped." [N6]
- Inference: an in-app plus email Notification to one user costs **1 run, not 2**. The docs bill per subscriber per trigger and never mention billing per step [N6][N7].
- Workflows are environment-scoped [N7]. The docs **do not state** whether the 5-workflow cap counts the same workflow in Dev and Prod once or twice.

## If we bring our own provider

Novu supports SendGrid, Amazon SES, Resend, Postmark, Brevo, Mailgun, Mailjet, SparkPost, Mandrill, MailerSend, Mailtrap, Plunk, Custom SMTP and others [N2]. Every one of them needs a verified sender (a domain or a single address) before it sends to real recipients.

| Provider | Free allowance | Before it sends to real users | What Novu needs |
|---|---|---|---|
| **Resend** | Free-forever plan: **3,000/month, 100/day**, 3 custom domains [R1]. Card requirement not stated | You must verify a domain you own [R2]: a DKIM `TXT` record, plus an SPF `TXT` record and an `MX` or `CNAME` record, copied from the Resend dashboard. CNAMEs must not be proxied. DMARC is optional [R3]. Novu allows `onboarding@resend.dev` as a test From address [N8]. Resend's own pages do not state the limits on it | API key, a From address on the verified domain, a sender name [N8] |
| **Mailgun** | Free plan: **100/day**, 1 custom domain [MG1]. Card requirement not stated | The sandbox domain sends only to **up to 5 authorized recipients** [MG2]. A custom domain needs **SPF TXT, DKIM TXT, a tracking CNAME and MX** [MG3]. A subdomain is recommended, and it must be verified [N9] | Private API key, domain, base URL (`https://api.eu.mailgun.net/` for EU domains), username, From address, sender name [N9] |
| **Postmark** | Free: **100/month**, no overages, **no card** [P1] | Until Postmark approves the account (under 24h on weekdays), you "won't be able to send to any email address outside the domains you've added to your account and verified" [P2]. Needs a sender signature or domain verification [N10] | Server API token, From address [N10] |
| **Amazon SES** | No fixed free email count. New AWS accounts get up to $200 of Free Tier credits and a 6-month free plan, and the credits must be used within 12 months. Paid sending starts at $0.10 per 1,000 emails à la carte [A1] | New accounts start in the **sandbox**: verified recipients only, **200 messages per 24h, 1 per second**. You request production access in the console, and AWS gives a first response within 96h [A2]. You verify a domain (DNS) or an address [N11] | IAM access key ID and secret, region, From address, sender name, and optionally a configuration set for activity tracking [N11] |
| **SendGrid** | **No free plan for new accounts.** A one-time **60-day trial at 100 emails/day** for accounts created from 2025-03-25 [SG1]. After that, paid Essentials plans start at $19.95/mo [SG2] | Single Sender Verification or Domain Authentication [N12] | API key with Mail Send at Full Access, a From address that matches the verified sender [N12] |

**Best fit for Cadence: Resend.**

- It has the biggest permanent free allowance (3,000/month).
- Setup in Novu is just an API key and a From address.
- There is no sandbox or approval step once the domain is verified.

Mailgun is second: 100/day, but it requires a tracking CNAME and an MX record. Postmark's 100/month is too small. SES comes with the sandbox and the approval wait. SendGrid is only a trial.

Whichever provider we pick, **Cadence needs a domain whose DNS we control**, ideally a sending subdomain such as `notify.<our-domain>`, and one more secret to store.

## Not verified

- Whether the 5-workflow cap counts a workflow once across Dev and Prod, or once per environment.
- The demo email's sender address, and whether it is active in the Prod environment too. The docs only say "your environments".
- Resend's own terms for `onboarding@resend.dev`, since only Novu's docs mention it. Whether Resend's and Mailgun's free plans need a card.
- The SendGrid trial details come from a Twilio support article [SG1]. The main SendGrid page says only "Sign up for a free trial—no credit card required."

## Sources

- [N1] Novu demo integration: https://docs.novu.co/platform/integrations/demo-integration
- [N2] Novu email integrations: https://docs.novu.co/platform/integrations/email
- [N3] Novu pricing: https://novu.co/pricing
- [N4] Novu system limits: https://docs.novu.co/platform/developer/limits
- [N5] Novu workflows: https://docs.novu.co/platform/concepts/workflows
- [N6] Novu trigger (billing): https://docs.novu.co/platform/concepts/trigger
- [N7] Novu glossary: https://docs.novu.co/platform/additional-resources/glossary
- [N8] Novu + Resend: https://docs.novu.co/platform/integrations/email/resend
- [N9] Novu + Mailgun: https://docs.novu.co/platform/integrations/email/mailgun
- [N10] Novu + Postmark: https://docs.novu.co/platform/integrations/email/postmark
- [N11] Novu + Amazon SES: https://docs.novu.co/platform/integrations/email/amazon-ses
- [N12] Novu + SendGrid: https://docs.novu.co/platform/integrations/email/sendgrid
- [R1] Resend pricing: https://resend.com/pricing
- [R2] Resend domains: https://resend.com/docs/dashboard/domains/introduction
- [R3] Resend add a domain: https://resend.com/docs/add-a-domain
- [MG1] Mailgun pricing: https://www.mailgun.com/pricing/
- [MG2] Mailgun sandbox domains: https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-sandbox
- [MG3] Mailgun domain verification: https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-verify
- [P1] Postmark pricing: https://postmarkapp.com/pricing
- [P2] Postmark account approval: https://postmarkapp.com/support/article/1084-how-does-the-account-approval-process-work
- [A1] Amazon SES pricing: https://aws.amazon.com/ses/pricing/
- [A2] SES sandbox / production access: https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html
- [SG1] SendGrid trial account plan: https://support.sendgrid.com/hc/en-us/articles/35270136965403
- [SG2] SendGrid Email API pricing: https://www.twilio.com/en-us/pricing/email-api
