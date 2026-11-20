import Knock, { signUserToken } from "@knocklabs/node";
import type {
  KnockFeedCredentials,
  KnockNotificationData,
} from "~/lib/knock-notification-feed-client";
import {
  summaryText,
  type FeedCredentials,
  type NotificationActor,
  type NotificationKind,
} from "~/lib/notifications";
import type {
  NotificationContent,
  NotificationProvider,
} from "~/lib/notification-provider.server";

// ─── Knock ───
// The Notification Provider adapter for Knock (ADR 0013). It and the Knock
// adapter in knock-notification-feed-client.ts are the only Cadence code that
// imports Knock. Cadence uses it whenever KNOCK_API_KEY is set, and
// docs/knock-setup.md lists what Knock's dashboard needs for it to work.

/** How Cadence reaches Knock, read from the environment. */
export type KnockSettings = {
  /** KNOCK_API_KEY: the secret key, which never leaves the server. */
  secretApiKey: string;
  /** KNOCK_PUBLIC_API_KEY: the public key, which goes to the browser. */
  publicApiKey: string;
  /** KNOCK_FEED_CHANNEL_ID: the id of the in-app feed channel. */
  feedChannelId: string;
  /**
   * KNOCK_SIGNING_KEY: signs the user tokens the browser shows Knock. Knock's
   * enhanced security, which is on in every environment, turns away a
   * browser without one. Without the key, feedCredentials fails closed.
   */
  signingKey: string | null;
};

// Each kind of Notification has its own Knock workflow, so grouping could be
// added per kind later.
const WORKFLOW_KEYS = {
  "refund-request-decided": "refund-request-decided",
  "open-refund-request": "open-refund-request",
  "seat-claimed": "seat-claimed",
  "discussion-question": "discussion-question",
  "discussion-reply": "discussion-reply",
} satisfies Record<NotificationKind, string>;

/**
 * Everything a workflow trigger carries: what the browser adapter reads back,
 * plus the finished text the workflow's templates print.
 */
type KnockTriggerData = KnockNotificationData & {
  /** The summary as plain text, for the in-app step's template. */
  summary_text: string;
  /** Only when Cadence asks for email. The email step is skipped without it. */
  email_subject?: string;
  email_body?: string;
};

// Knock's default, an hour. The browser adapter asks Cadence for a fresh one
// before it runs out.
const USER_TOKEN_SECONDS = 60 * 60;

// Knock's client waits 60 seconds and retries twice by default. Cadence waits
// for Knock while a page loads or an action finishes, so it gives up sooner.
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 1;

function triggerData(
  kind: NotificationKind,
  actor: NotificationActor | null,
  content: NotificationContent
): KnockTriggerData {
  return {
    kind,
    // Not Knock's own actor field: Knock would show everything it holds about
    // the actor to every recipient's browser, including their email address.
    actor_name: actor?.name ?? null,
    actor_avatar_url: actor?.avatarUrl ?? null,
    summary: content.summary,
    summary_text: summaryText(content.summary),
    excerpt: content.excerpt,
    context: content.context,
    url: content.url,
    ...(content.email && {
      email_subject: content.email.subject,
      email_body: content.email.body,
    }),
  };
}

export function createKnockNotificationProvider(
  settings: KnockSettings
): NotificationProvider {
  const knock = new Knock({
    apiKey: settings.secretApiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  });

  return {
    // Knock registers each recipient from the trigger itself. It only ever
    // learns their id and email address.
    async send({ kind, recipients, actor, content }) {
      const { workflow_run_id } = await knock.workflows.trigger(
        WORKFLOW_KEYS[kind],
        {
          recipients: recipients.map((recipient) => ({
            id: String(recipient.id),
            email: recipient.email,
          })),
          data: triggerData(kind, actor, content),
        }
      );
      return workflow_run_id;
    },

    // Fails closed. A browser with no signed user token only gets in while
    // Knock's enhanced security is off, and then Knock's public key can read
    // anyone's feed. So without the signing key, Cadence gives the browser
    // nothing to connect with, and the page opens without the bell.
    async feedCredentials(userId): Promise<FeedCredentials> {
      if (settings.signingKey === null) {
        throw new Error(
          "KNOCK_SIGNING_KEY isn't set, so Cadence can't sign the user token " +
            "Knock's enhanced security needs, and gives the browser no " +
            "Notification Feed credentials. See docs/knock-setup.md."
        );
      }

      // What Knock's browser adapter parses back out.
      const knockUserId = String(userId);
      const credentials: KnockFeedCredentials = {
        userId: knockUserId,
        publicApiKey: settings.publicApiKey,
        feedChannelId: settings.feedChannelId,
        userToken: await signUserToken(knockUserId, {
          signingKey: settings.signingKey,
          expiresInSeconds: USER_TOKEN_SECONDS,
        }),
      };
      return credentials;
    },

    // Only finds the in-app message while Knock still keeps its message log,
    // which is 30 days on Knock's free plan.
    async markRead({ workflowRunId, userId }) {
      const messages = await knock.users.listMessages(String(userId), {
        workflow_run_id: workflowRunId,
        channel_id: settings.feedChannelId,
      });
      if (messages.items.length === 0) {
        // Knock runs workflows asynchronously, so a page opened straight after
        // the send can come before the in-app message exists. Throwing makes
        // Cadence ask again the next time the page opens.
        throw new Error(
          `Knock has no in-app message from workflow run ${workflowRunId} for user ${userId} yet`
        );
      }

      const unread = messages.items.filter((message) => !message.read_at);
      if (unread.length > 0) {
        await knock.messages.batch.markAsRead({
          message_ids: unread.map((message) => message.id),
        });
      }
    },
  };
}

/**
 * Reads how to reach Knock from the environment. Throws, naming what's
 * missing, when KNOCK_API_KEY is set without the rest.
 */
export function knockSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): KnockSettings {
  const {
    KNOCK_API_KEY: secretApiKey,
    KNOCK_PUBLIC_API_KEY: publicApiKey,
    KNOCK_FEED_CHANNEL_ID: feedChannelId,
  } = env;

  if (!secretApiKey || !publicApiKey || !feedChannelId) {
    const missing = Object.entries({
      KNOCK_API_KEY: secretApiKey,
      KNOCK_PUBLIC_API_KEY: publicApiKey,
      KNOCK_FEED_CHANNEL_ID: feedChannelId,
    })
      .filter(([, value]) => !value)
      .map(([name]) => name);
    throw new Error(
      `Cadence can't reach Knock: ${missing.join(" and ")} ${missing.length === 1 ? "isn't" : "aren't"} set. ` +
        "See docs/knock-setup.md, or unset KNOCK_API_KEY to use the fake Notification Provider."
    );
  }

  // The public key goes to every signed-in person's browser.
  if (!publicApiKey.startsWith("pk_")) {
    throw new Error(
      "KNOCK_PUBLIC_API_KEY must be Knock's public key, which starts with pk_. " +
        "It's sent to the browser, so it must never be the secret key."
    );
  }

  return {
    secretApiKey,
    publicApiKey,
    feedChannelId,
    signingKey: env.KNOCK_SIGNING_KEY || null,
  };
}

let configured: NotificationProvider | undefined;

/** The Knock adapter, set up from the environment the first time it's asked for. */
export function configuredKnockNotificationProvider(): NotificationProvider {
  configured ??= createKnockNotificationProvider(knockSettingsFromEnv());
  return configured;
}
