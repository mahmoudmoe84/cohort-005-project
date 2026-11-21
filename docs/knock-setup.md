# Setting up Knock

Cadence's Notification Provider is Knock, on its free plan, behind Cadence's own interfaces ([ADR 0013](adr/0013-the-notification-provider-sits-behind-cadences-own-interface.md)). Two adapters talk to it:

- `app/lib/knock-notification-provider.server.ts` on the server.
- `app/lib/knock-notification-feed-client.ts` in the browser.

Without `KNOCK_API_KEY`, Cadence uses its fake Notification Provider instead. Notifications then live in memory, and their email goes to `.outbox/`. Nothing below is needed for that.

To use Knock, a person with access to Knock's and Postmark's dashboards does the steps below in both of Knock's environments: Development and Production.

## 1. Environment variables

| Variable                | Value                                                      | Notes                                                                                           |
| ----------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `KNOCK_API_KEY`         | The environment's secret key (`sk_…`)                      | Server only. Setting it switches Cadence from the fake to Knock.                                |
| `KNOCK_PUBLIC_API_KEY`  | The environment's public key (`pk_…`)                      | Sent to the browser. Cadence refuses a value that doesn't start with `pk_`.                     |
| `KNOCK_FEED_CHANNEL_ID` | The in-app feed channel's id (a UUID)                      | Used by the server to find messages and by the browser to read the feed.                        |
| `KNOCK_SIGNING_KEY`     | The environment's signing key                              | Required. Signs the user token the browser shows Knock, which enhanced security needs (step 5). |
| `APP_URL`               | Cadence's public origin, such as `https://cadence.example` | Notification email links are built from it. Without it they point at `http://localhost:5173`.   |

- The keys and the signing key are under **Platform > API keys** in Knock's dashboard. Knock shows the signing key only once.
- Use the base64 form of the signing key, which starts `LS0tLS1CRUdJTi`, so it fits on one line.
- The signing key must be PKCS#8, so it decodes to `-----BEGIN PRIVATE KEY-----`. If it decodes to `-----BEGIN RSA PRIVATE KEY-----` (PKCS#1), convert it once with `openssl pkcs8 -topk8 -nocrypt -in key.pem`. Otherwise every page logs `Couldn't get the Notification Feed credentials` and shows no bell.
- Without `KNOCK_SIGNING_KEY`, Cadence fails closed: it gives the browser no Notification Feed credentials, so there's no bell, and every page logs `Couldn't get the Notification Feed credentials` with the reason. Notifications are still sent and emailed.
- Locally, put them in `.env`, which is gitignored; `npm run dev` loads it. In production, set them in the host's environment.

## 2. Email through Postmark

Knock's own email channel only reaches members of the Knock account, so Cadence brings Postmark.

1. In Postmark, verify `support@superhumanai.tech` (or the `superhumanai.tech` domain) as a sender.
   - A new Postmark account is pending approval until Postmark reviews it. Until then, Postmark refuses every recipient outside the From address's domain (HTTP 422, ErrorCode 412).
   - Ask Postmark to approve the account before Production.
   - To check Development before that, send to an address at `superhumanai.tech`.
2. In Postmark, create a sandbox server for Development. Production uses the existing server, the one whose token is `POSTMARK_SERVER_TOKEN`.
3. In Knock, add a Postmark email channel and set it up per environment:
   - **API key:** the sandbox server's token in Development, the existing server's token in Production.
   - **From email address:** `support@superhumanai.tech`. **From name:** `Cadence`.
   - **Message stream:** leave it alone. Knock names no stream, so Postmark uses the transactional `outbound` stream.
   - **Payload overrides**, under Advanced, then Overrides: `{"HtmlBody": null}`. Knock then sends each email as plain text only (see §4).
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

In the workflow, the email step is the box named **Postmark**. Click it, then click **Edit content**.

- **Step condition:** `data.email_body` is not empty. Cadence leaves out the email fields when the person's switch is off, so the step is skipped and sends nothing.
- **Email layout:** none. The box then shows "Select layout", which is how Knock shows no layout.
- **Subject:** `{{ data.email_subject }}`
- **Preview text:** empty.
- **HTML:** under Content, click **Code editor** and replace everything with the line below. Don't use the visual editor's Markdown block, because it wraps the text in tables.

  ```liquid
  {{ data.email_body | escape | newline_to_br }}
  ```

- **Plain text:** click **Plaintext** and turn off **Auto-generate plaintext**. Otherwise Knock makes the text part from the HTML and re-wraps it at about 65 columns. Set the text to `{{ data.email_body }}`, with no filter, so the text part is exactly Cadence's plain-text body.
- **Save and commit:** click **Save changes**, then **Commit**. Knock's API triggers use only committed workflows.

Spec #28 asks for plain-text email. Knock's email step needs an HTML body, but the channel's payload override (§2) sends `"HtmlBody": null`, so Postmark gets only the text part. The HTML above is a fallback if someone removes that override. It is the same text with only line breaks added, and `escape` keeps characters such as `<` showing as written.

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

## 5. Enhanced security, in every environment

Turn on **enhanced security** under **Platform > API keys**, in Development and in Production alike, with `KNOCK_SIGNING_KEY` set. Without it, Knock's public key can read anyone's feed, whatever Cadence does. Knock suggests Development can leave it off; Cadence doesn't, because the public key reaches every signed-in browser in both.

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
2. Discussion Reply and Refund Request decided email reach the Postmark sandbox server, from `support@superhumanai.tech`. Each email has only a text part, and that text is exactly the body Cadence sent.
3. Clicking a Notification, and "Mark all as read", mark them read in Knock's message log. "Mark all as read" must leave another person's Notifications unread: Knock's client scopes it with `user_ids`, which Knock's API reference doesn't list.
4. Opening the page a Notification links to (from its email, say) marks it read in Knock.
5. A DevUI user switch shows the new person's Notifications.
6. Enhanced security is on: Knock refuses `GET /v1/users/{user_id}/feeds/{channel_id}` sent with the public key and no user token.
The first check passed on 2026-11-21, and its results are on issue #36.

## Answered questions

These were checked against Knock Development on 2026-11-21.

1. **Does an open Notification Feed update live after Cadence marks a Notification read on the server?** No. Knock's socket sends nothing when a Notification is read. With the feed open, the badge and the unread dot stayed the same for 20 seconds. The next arrival corrects the badge, because the client then fetches the feed again. The dots correct at the next navigation, when Cadence's bell fetches the newest page again.
2. **Does the free plan require Knock branding when Knock's UI components aren't used?** Knock adds no branding to the email: neither part contains "Knock" or "Powered by". Cadence's own UI shows none. The feed settings (`GET /v1/users/{user_id}/feeds/{channel_id}/settings`) report `branding_required: true`, but that flag only turns on the footer of Knock's own feed component, which Cadence doesn't use. Only Knock support can say whether its terms ask for more.
3. **Can Knock send Notification email as plain text only?** Yes, with the Postmark channel's payload override `{"HtmlBody": null}` (§2). Postmark accepts it and stores each email as a single `text/plain` part.

## Known limits

- Knock keeps its message log for 30 days on the free plan. Opening a page more than 30 days after its Notification can't mark it read on the server. Cadence gives up on it after three tries, so it stays unread in the bell until the person clicks it or marks all as read.
- Knock runs workflows asynchronously. A page opened in the moment after a send can come before the in-app message exists. Cadence then asks again the next time the page opens, which uses one of the three tries.
- Opening a page waits for Knock at most a second, however many Notifications it marks read. Marks that take longer finish in the background, and the bell shows them after the next navigation.
- The user token lasts an hour. Before it runs out, the browser asks `/api/notification-feed-credentials` for a fresh one. If Cadence can't sign one, the route answers 503 and the browser logs it. The bell then stops updating once the old token runs out, until the next full page load.
- Knock's client drops the socket 30 seconds after the tab is hidden. Notifications that arrive meanwhile appear after the next navigation or with the next arrival.
- Knock's client skips fetching an arrival while it's already fetching. The badge still counts it, but it doesn't pop up, and it joins the list at the next navigation.
