# Which third-party notification service should Cadence use?

Research for issue #13. Sources were read on 2026-11-15. Every claim links to the vendor's own docs or pricing page. Where a vendor page did not say something, this file says "not stated" and does not guess.

## Recommendation

**Use Novu (Novu Cloud free tier). Knock is the close second.**

- Novu is the only one of the five whose prebuilt Inbox takes **Tailwind class names directly** (`appearance.elements`). It also ships headless React hooks, so the bell and list can match Cadence's Tailwind/Radix look whichever way we build them.
- Its free tier gives 10,000 workflow runs a month with **no credit card**, unlimited subscribers, email plus in-app, read/unread/seen/archive, and a preferences UI.
- It is the only one with a real **self-hosting** path for the core product, since the core is MIT-licensed. That leaves a way out if the price or vendor terms ever stop working for us.
- The first paid tier is $30/month. Knock and MagicBell both jump to about $250/month.

Pick **Knock** instead if the free tier's **5-workflow cap** or **24-hour activity log** is a problem. Knock's free tier has no workflow cap and includes preferences. Its styling uses `--rnf-` CSS variables, custom renderers or headless hooks rather than Tailwind classes, and it has no self-hosted option.

## Comparison

| | Knock | Novu | MagicBell | Courier | SuprSend |
|---|---|---|---|---|---|
| Free tier (no card) | 10k messages/mo, **no card** [K1] | 10k workflow runs/mo, **no card**, max 5 workflows, 24h activity log [N1] | **1k deliveries/mo**, card requirement not stated [M1] | 10k sends/mo [C1]; card requirement not stated on the pricing page | 10k notifications/mo, **no card**; **preferences not on Free**; inbox shows SuprSend branding [S1] |
| First paid tier | $250/mo [K1] | $30/mo [N1] | $249/mo [M1] | $0.005/send, pay as you go [C1] | $100/mo [S1] |
| In-app list, live delivery | Yes, over a WebSocket [K3] | Yes, over a WebSocket (`realtime` option) [N4] | Yes, over a "persistent connection" [M4] | Yes, WebSocket via `inbox.listenForUpdates()` [C2] | Yes, socket with a reachability status [S3] |
| Email from the same service | Yes [K1] | Yes [N1] | Yes, through SES, Mailgun, SendGrid or SMTP [M2] | Yes [C3] | Yes [S1] |
| React prebuilt components | `NotificationFeedPopover`, `NotificationFeed`, `NotificationIconButton` [K2] | `<Inbox />` with bell, feed and preferences [N2] | `Inbox`, `FloatingInbox`, `UserPreferences` [M3] | `CourierInbox`, `CourierInboxPopupMenu`, `CourierToast`, `CourierPreferences` [C2] | Drop-in `@suprsend/react` [S2] |
| Headless hooks | Yes [K2] | `@novu/react` hooks such as `useNotifications` [N2][N4] | None in the React docs [M3] | `useCourier()` [C2] | `useFeedClient`, `useFeedData`, `useFeed` (`@suprsend/react-core`) [S3] |
| Styling for Tailwind/Radix | `--rnf-` CSS variables, replace the CSS, `renderItem` [K3] | **Tailwind classes per element**, plus variables and CSS variables [N5] | CSS custom properties and an `unstyled` prop [M3] | Theme objects and custom render slots [C2] | `theme` prop, or headless [S3] |
| Opaque user ids only | Yes, `id` is the only required field [K4] | Yes, `subscriberId` is the only required field [N3] | Yes, `external_id` [M5] | Yes, `user_id` [C3] | Yes, `distinct_id` [S4] |
| What email needs | An `email` on the user, required for email channels; can be sent inline in the trigger [K4][K5] | An `email` on the subscriber; can be sent inline in the trigger `to` [N3] | The email address, used as the email channel's token [M5] | `profile.email`, or an inline `to.email` [C3] | `$email` on the user, or inline on the recipient [S4] |
| Read/unread | read, seen and archived; badge counts unread or unseen [K2][K3] | read, unread, seen, archive and snooze [N4] | read/unread and archive [M3][M4] | `read`, `opened`, `archived` [C2] | `markAsRead`, `markAsSeen` [S3] |
| Per-user preferences | By channel type, workflow and category; hosted or custom preference center; defaults to opted in [K6] | Preferences in Inbox, per workflow and channel [N2] | By channel and category [M4] | Topics, opt in/out/required, tenant layers [C4] | **Paid plans only** [S1] |
| Node server SDK | `@knocklabs/node`; `signUserToken` signs the RS256 feed JWT [K7] | `@novu/api` [N3] | `magicbell-js` (browser/Node client) [M6] | `@trycourier/courier` [C3] | `@suprsend/node-sdk` [S4] |
| Client auth | Signed user token ("enhanced security mode") [K3][K7] | `subscriberId`, plus an HMAC `subscriberHash` in production [N2] | Server-generated User JWT [M3] | Server-minted JWT [C2] | Signed JWT user token [S2] |
| Self-hosting | Not offered (nothing in docs or pricing) | **Yes**: MIT core, Community self-hosted edition [N6][N7] | Not mentioned [M1] | **No**: "no self-hosted or on-premise option" [C1b] | Enterprise plan only [S1] |

## How it fits React Router 8

All five follow the same pattern, so this does not separate them:

- **Server (loaders and actions).** Call the Node SDK from server code, for example an action that triggers a workflow when something happens in Cadence. A loader signs a per-user token (Knock `signUserToken` [K7], Novu `subscriberHash` HMAC [N2], Courier JWT [C2], SuprSend JWT [S2], MagicBell User JWT [M3]) and returns it to the page. The API secret never leaves the server.
- **Client.** The inbox components open a browser WebSocket, so they mount only on the client. Courier says this outright for Next.js (`'use client'`) [C2]. In React Router, render the bell in a client-only boundary and pass the token from the loader.
- **Opaque ids.** Every vendor accepts Cadence's own user id as the recipient key, and none needs an email for the in-app list. **Email does need an address.** Cadence has to send the user's email to the vendor, either inline with each trigger (Knock [K5], Novu [N3], SuprSend [S4], Courier per message [C3]) or by syncing the user profile once. Sending ids only works for in-app and stops working for email.

## Trade-offs of choosing Novu

- **Upsides:** Tailwind class hooks [N5]; headless hooks with built-in WebSocket updates [N4]; a $30 first paid tier [N1]; an MIT self-host way out [N6][N7]. Digest, preferences and all Inbox components are also available when self-hosted [N6].
- **Free-tier limits:** 5 workflows, 2 environments, 3 team members, and 24-hour activity-feed retention [N1]. Count the Cadence notification types before committing.
- **Self-host gaps:** these are cloud-only: removing Novu branding, Inbox snooze, email activity tracking, SSO/RBAC, and more than 2 environments [N6]. The `/enterprise` folder is under a commercial license [N7].
- **Production auth:** turn on HMAC (`subscriberHash`) so one user cannot read another's inbox [N2].

## Why not the others

- **Knock:** a strong second, with 10k messages, no card, preferences and unlimited feeds on Free [K1]. It loses on the $250 step to paid, no self-hosting, and styling through CSS variables rather than Tailwind classes [K3].
- **Courier:** a solid SDK with live updates, but no self-hosting [C1b], and its pricing page does not say whether the free tier needs a card [C1].
- **SuprSend:** preferences are not on the free plan, and the free inbox carries SuprSend branding [S1].
- **MagicBell:** only 1,000 deliveries a month on Builder, $249 next [M1], and no headless hooks in its React docs [M3].

## Not verified

- Whether Novu Cloud's free tier includes a built-in email sender or needs our own email provider (Resend, SES and so on). Check this before building.
- Courier's no-card claim appears in Courier marketing pages, not on the pricing page [C1].
- MagicBell's real-time transport is not named [M4].

## Sources

- [K1] Knock pricing: https://knock.app/pricing
- [K2] Knock React overview: https://docs.knock.app/in-app-ui/react/overview
- [K3] Knock React feed: https://docs.knock.app/in-app-ui/react/feed
- [K4] Knock users: https://docs.knock.app/concepts/users
- [K5] Knock identifying recipients (inline identification): https://docs.knock.app/managing-recipients/identifying-recipients
- [K6] Knock preferences: https://docs.knock.app/preferences/overview
- [K7] Knock security and authentication: https://docs.knock.app/in-app-ui/security-and-authentication
- [N1] Novu pricing: https://novu.co/pricing
- [N2] Novu Inbox overview: https://docs.novu.co/platform/inbox/overview
- [N3] Novu subscribers: https://docs.novu.co/platform/concepts/subscribers
- [N4] Novu `useNotifications`: https://docs.novu.co/platform/sdks/react/hooks/use-notifications
- [N5] Novu Inbox styling: https://docs.novu.co/platform/inbox/configuration/styling
- [N6] Novu self-hosted vs cloud: https://docs.novu.co/community/self-hosted-and-novu-cloud
- [N7] Novu repo and license: https://github.com/novuhq/novu
- [M1] MagicBell pricing: https://www.magicbell.com/pricing
- [M2] MagicBell docs index (email providers): https://www.magicbell.com/docs
- [M3] MagicBell React: https://www.magicbell.com/docs/libraries/magicbell-react
- [M4] MagicBell in-app channel: https://www.magicbell.com/docs/channels/in_app
- [M5] MagicBell user: https://www.magicbell.com/docs/primitive/user
- [M6] MagicBell JS client: https://www.magicbell.com/docs/libraries/magicbell-js
- [C1] Courier pricing: https://www.courier.com/pricing
- [C1b] Courier docs overview: https://www.courier.com/docs/overview
- [C2] Courier React SDK: https://www.courier.com/docs/sdk-libraries/courier-react-web
- [C3] Courier users: https://www.courier.com/docs/platform/users/users
- [C4] Courier preferences: https://www.courier.com/docs/platform/preferences/preferences-overview
- [S1] SuprSend pricing: https://www.suprsend.com/pricing
- [S2] SuprSend React inbox: https://docs.suprsend.com/docs/inbox-react
- [S3] SuprSend headless feed: https://docs.suprsend.com/docs/headless-feed
- [S4] SuprSend users: https://docs.suprsend.com/docs/users
