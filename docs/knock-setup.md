# Setting up Knock

Cadence's Notification Provider is Knock, on its free plan, behind Cadence's own interfaces ([ADR 0013](adr/0013-the-notification-provider-sits-behind-cadences-own-interface.md)). Two adapters talk to it:

- `app/lib/knock-notification-provider.server.ts` on the server.
- `app/lib/knock-notification-feed-client.ts` in the browser.

Without `KNOCK_API_KEY`, Cadence uses its fake Notification Provider instead. Notifications then live in memory, and their email goes to `.outbox/`. Nothing below is needed for that.

To use Knock, a person with access to Knock's and Postmark's dashboards does the steps below in both of Knock's environments: Development and Production.

## 1. Environment variables

| Variable                | Value                                                      | Notes                                                                                         |
| ----------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `KNOCK_API_KEY`         | The environment's secret key (`sk_…`)                      | Server only. Setting it switches Cadence from the fake to Knock.                              |
| `KNOCK_PUBLIC_API_KEY`  | The environment's public key (`pk_…`)                      | Sent to the browser. Cadence refuses a value that doesn't start with `pk_`.                   |
| `KNOCK_FEED_CHANNEL_ID` | The in-app feed channel's id (a UUID)                      | Used by the server to find messages and by the browser to read the feed.                      |
| `KNOCK_SIGNING_KEY`     | The environment's signing key                              | Signs the user token the browser shows Knock. Required once enhanced security is on (step 5). |
| `APP_URL`               | Cadence's public origin, such as `https://cadence.example` | Notification email links are built from it. Without it they point at `http://localhost:5173`. |

- The keys and the signing key are under **Platform > API keys** in Knock's dashboard. Knock shows the signing key only once.
- Use the base64 form of the signing key, which starts `LS0tLS1CRUdJTi`, so it fits on one line.
- The signing key must be PKCS#8, so it decodes to `-----BEGIN PRIVATE KEY-----`. If it decodes to `-----BEGIN RSA PRIVATE KEY-----` (PKCS#1), convert it once with `openssl pkcs8 -topk8 -nocrypt -in key.pem`. Otherwise every page logs `Couldn't get the Notification Feed credentials` and shows no bell.
- Locally, put them in `.env`, which is gitignored; `npm run dev` loads it. In production, set them in the host's environment.

## 2. Email through Postmark

Knock's own email channel only reaches members of the Knock account, so Cadence brings Postmark.

1. In Postmark, verify `support@superhumanai.tech` (or the `superhumanai.tech` domain) as a sender.
2. In Postmark, create a sandbox server for Development. Production uses the existing server, the one whose token is `POSTMARK_SERVER_TOKEN`.
3. In Knock, add a Postmark email channel and set it up per environment:
   - **API key:** the sandbox server's token in Development, the existing server's token in Production.
   - **From email address:** `support@superhumanai.tech`. **From name:** `Cadence`.
   - **Message stream:** leave it alone. Knock names no stream, so Postmark uses the transactional `outbound` stream.
4. Leave all four tracking toggles off: Knock's open and link tracking, and Postmark's. Cadence marks a Notification read when its page is opened, not when its email is opened.

## 3. The in-app feed channel

Add an in-app feed channel in Knock, or use the one already there, and copy its id into `KNOCK_FEED_CHANNEL_ID`. Leave its link tracking off.

Optional: the channel's API response filter can keep the email text out of the browser, for example `{"data": {"except": ["email_subject", "email_body"]}}`. Each recipient only ever sees their own email's text either way.

## 4. The five workflows

Create these workflows, with these exact keys (`WORKFLOW_KEYS` in the server adapter).

| Workflow key             | Steps                   |
| ------------------------ | ----------------------- |
| `refund-request-decided` | In-app feed, then email |
| `open-refund-request`    | In-app feed             |
| `seat-claimed`           | In-app feed             |
| `discussion-question`    | In-app feed             |
| `discussion-reply`       | In-app feed, then email |

Cadence writes all the wording. Each workflow's templates only print fields Cadence sends, so leave out any other text.

**In-app feed step**

- Markdown body: `{{ data.summary_text }}`
- Action URL: leave it empty. Cadence's bell links to `data.url` and never shows what Knock renders.

**Email step** (only in `refund-request-decided` and `discussion-reply`)

- Step condition: `data.email_body` is not empty. Cadence leaves the email fields out when the person's switch is off, so the step is skipped and sends nothing.
- Layout: **No layout**.
- Subject: `{{ data.email_subject }}`
- Text body: `{{ data.email_body }}`
- HTML body, which Knock requires. It prints the same text:

  ```html
  <!DOCTYPE html>
  <html>
    <body>
      <pre style="white-space: pre-wrap; font-family: inherit">
  {{ data.email_body | escape }}</pre>
    </body>
  </html>
  ```

These are the fields each trigger's `data` carries:

| Field                            | What it is                                                   |
| -------------------------------- | ------------------------------------------------------------ |
| `kind`                           | One of Cadence's five kinds of Notification                  |
| `actor_name`, `actor_avatar_url` | Who did the thing; both `null` when it's Cadence itself      |
| `summary`                        | The message as parts, with names marked strong               |
| `summary_text`                   | The same message as plain text                               |
| `excerpt`, `context`, `url`      | The quoted text, where it happened, and the path it links to |
| `email_subject`, `email_body`    | Only when Cadence asks for email                             |

Recipients carry only the person's id and email address. Cadence doesn't use Knock's `actor` field, because Knock would show everything it holds about an actor, including their email address, to each recipient's browser.

## 5. Production only

Turn on **enhanced security** under **Platform > API keys**, with `KNOCK_SIGNING_KEY` set. Without it, Knock's public key can read anyone's feed. Development can leave it off.

## 6. Check it in Development

Run Cadence against Knock Development, with the seed data (`npm run db:seed`). Each kind can be made to happen like this, with the recipient signed in in another browser profile:

| Kind                   | Who does what                                                                             | Who hears                        |
| ---------------------- | ----------------------------------------------------------------------------------------- | -------------------------------- |
| Discussion Question    | Liam Thompson posts a comment on "What is TypeScript?" in Introduction to TypeScript      | Sarah Chen, its Instructor       |
| Discussion Reply       | Sarah Chen replies to it                                                                  | Liam Thompson, also by email     |
| Refund Request decided | Alex Rivera declines Liam's Open Refund Request on `/admin/refunds`                       | Liam Thompson, also by email     |
| Open Refund Request    | Liam then raises a new Refund Request from the course page                                | Alex Rivera, the Platform Admin  |
| Seat claimed           | James Park sets the DevUI country to US and claims a Seat at `/redeem/TEAM-NODEJS-G7H8I9` | Bossy McBossface, the Team Admin |

Then check each of these:

1. All five kinds arrive in the bell live, with a pop-up, while the recipient's page is open.
2. Discussion Reply and Refund Request decided email reach the Postmark sandbox server, from `support@superhumanai.tech`, and read well as plain text.
3. Clicking a Notification, and "Mark all as read", mark them read in Knock's message log. "Mark all as read" must leave another person's Notifications unread: Knock's client scopes it with `user_ids`, which Knock's API reference doesn't list.
4. Opening the page a Notification links to (from its email, say) marks it read in Knock.
5. A DevUI user switch shows the new person's Notifications.
6. The two open questions below. Record the results on issue #36.

## Open questions

Neither has been checked against a live Knock account. What Knock's docs and source say:

1. **Does an open Notification Feed update live after Cadence marks a Notification read on the server?** Probably not. Knock's socket only sends `new-message`, and its JS client handles nothing else. So the next arrival brings the badge back in line, because its payload carries the counts, but the dots on Notifications already listed stay until the next navigation, when Cadence's bell looks at the newest page again.
2. **Does the free plan require Knock branding when Knock's UI components aren't used?** Not for Cadence's own UI, as far as the docs go. The pricing page lists "Remove Knock branding" as not on the free plan without saying where the branding appears, and Knock's terms set no duty to show it. A `branding_required` flag in the feed settings drives the "Powered by Knock" footer of Knock's own React feed, which Cadence doesn't use. A Knock FAQ suggests Knock adds "Powered by Knock" to email. To check, read a sent email's HTML and text in the Postmark sandbox, and call `GET /v1/users/{user_id}/feeds/{channel_id}/settings`.

## Known limits

- Knock keeps its message log for 30 days on the free plan. Opening a page more than 30 days after its Notification can't mark it read on the server, and Cadence asks again each time that page opens.
- Knock runs workflows asynchronously. A page opened in the moment after a send can come before the in-app message exists. Cadence then asks again the next time the page opens.
- Knock always sends an HTML part with email, while spec #28 asks for plain text only. Whether a Postmark payload override can drop it isn't known.
- The user token lasts an hour. Before it runs out, the browser asks `/api/notification-feed-credentials` for a fresh one.
- Knock's client drops the socket 30 seconds after the tab is hidden. Notifications that arrive meanwhile appear after the next navigation or with the next arrival.
- Knock's client skips fetching an arrival while it's already fetching. The badge still counts it, but it doesn't pop up, and it joins the list at the next navigation.
