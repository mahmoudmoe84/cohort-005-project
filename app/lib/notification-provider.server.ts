import { randomUUID } from "node:crypto";
import type {
  FeedCredentials,
  Notification,
  NotificationActor,
  NotificationKind,
  SummaryPart,
} from "~/lib/notifications";
import { outboxTransport, type MailTransport } from "~/lib/mailer.server";
import { configuredKnockNotificationProvider } from "~/lib/knock-notification-provider.server";

// ─── Notification Provider ───
// The outside service that stores and delivers Notifications sits behind this
// interface, modelled on MailTransport in mailer.server.ts (ADR 0013). Nothing
// outside the adapters knows which provider it is. Cadence writes all the
// wording, so a send carries finished text.
//
// Cadence uses Knock, through knock-notification-provider.server.ts, whenever
// KNOCK_API_KEY is set (docs/knock-setup.md), and the fake below otherwise.

export type NotificationRecipient = { id: number; email: string };

/** Plain text, written by Cadence. The provider sends it as it is. */
export type NotificationEmail = { subject: string; body: string };

export type NotificationContent = {
  summary: SummaryPart[];
  excerpt: string | null;
  context: string;
  url: string;
  /**
   * Only when the Notification should go by email as well as in-app. Leaving
   * it out is how the switch on Notification settings takes effect.
   */
  email?: NotificationEmail;
};

export type NotificationSend = {
  kind: NotificationKind;
  recipients: NotificationRecipient[];
  actor: NotificationActor | null;
  content: NotificationContent;
};

/** One person's copy of what one send put in the Notification Feed. */
export type NotificationReadMark = { workflowRunId: string; userId: number };

export interface NotificationProvider {
  /** Sends one Notification to every recipient and returns its workflow run id. */
  send(notification: NotificationSend): Promise<string>;
  /** What the browser adapter needs to connect to this person's Notification Feed. */
  feedCredentials(userId: number): Promise<FeedCredentials>;
  /**
   * Marks read what that send put in that person's Notification Feed, and
   * nobody else's. Resolves once it's read, including when it already was,
   * and Cadence doesn't ask about it again. Throws if it can't be marked.
   * Cadence then asks again the next time the person opens its page, and
   * gives up after three tries.
   */
  markRead(mark: NotificationReadMark): Promise<void>;
}

// ─── The fake ───
// Keeps Notifications in memory: tests check what was sent and marked read,
// and the dev-only route api/fake-notification-feed serves each person's
// Notification Feed to the fake browser client. Email it's asked for goes to
// each recipient through `mail`, which is the .outbox/ transport for the fake
// Cadence uses. Without `mail`, email is only recorded in `sent`.

const FEED_PAGE_SIZE = 20;

// Notification email comes from this address, unlike Cadence's other
// transactional email. Through Knock it's set on Knock's Postmark channel
// (docs/knock-setup.md); the fake sends from it too.
const NOTIFICATION_EMAIL_FROM = "Cadence <support@superhumanai.tech>";

export type FakeNotificationFeed = {
  /** Newest first. Pass the last page's nextCursor for older Notifications. */
  page(cursor?: string): {
    notifications: Notification[];
    nextCursor: string | null;
  };
  unreadCount(): number;
  markRead(notificationId: string): void;
  markAllRead(): void;
};

export type FakeNotificationProvider = NotificationProvider & {
  /** Every send, oldest first, with the workflow run id it returned. */
  readonly sent: (NotificationSend & { workflowRunId: string })[];
  /** Every markRead, oldest first. */
  readonly markedRead: NotificationReadMark[];
  /** One person's Notification Feed. */
  feedOf(userId: number): FakeNotificationFeed;
};

// Each recipient gets their own copy of a send, with its own read state.
type Delivered = {
  workflowRunId: string;
  recipientId: number;
  notification: Notification;
};

export function createFakeNotificationProvider(
  mail?: MailTransport
): FakeNotificationProvider {
  const sent: FakeNotificationProvider["sent"] = [];
  const markedRead: NotificationReadMark[] = [];
  const delivered: Delivered[] = [];

  function newestFirst(userId: number) {
    return delivered
      .filter((copy) => copy.recipientId === userId)
      .map((copy) => copy.notification)
      .reverse();
  }

  return {
    sent,
    markedRead,

    async send(notification) {
      // Unique across restarts of the dev server, which empty the fake but
      // not the database that stores these ids.
      const workflowRunId = `fake-run-${randomUUID()}`;
      sent.push({ ...notification, workflowRunId });
      const { summary, excerpt, context, url } = notification.content;
      const insertedAt = new Date().toISOString();
      for (const recipient of notification.recipients) {
        delivered.push({
          workflowRunId,
          recipientId: recipient.id,
          notification: {
            id: String(delivered.length + 1),
            kind: notification.kind,
            actor: notification.actor,
            summary,
            excerpt,
            context,
            url,
            insertedAt,
            readAt: null,
          },
        });
      }
      const { email } = notification.content;
      if (email && mail) {
        for (const recipient of notification.recipients) {
          await mail.send({
            from: NOTIFICATION_EMAIL_FROM,
            to: recipient.email,
            ...email,
          });
        }
      }
      return workflowRunId;
    },

    async feedCredentials(userId) {
      return { provider: "fake", userId };
    },

    async markRead({ workflowRunId, userId }) {
      markedRead.push({ workflowRunId, userId });
      const now = new Date().toISOString();
      for (const copy of delivered) {
        if (
          copy.workflowRunId === workflowRunId &&
          copy.recipientId === userId
        ) {
          copy.notification.readAt ??= now;
        }
      }
    },

    feedOf(userId) {
      return {
        // The cursor is the id of the last Notification on the previous page.
        page(cursor) {
          const all = newestFirst(userId);
          const start =
            cursor === undefined
              ? 0
              : all.findIndex((notification) => notification.id === cursor) + 1;
          const notifications = all.slice(start, start + FEED_PAGE_SIZE);
          const last = notifications.at(-1);
          const hasMore = start + notifications.length < all.length;
          return {
            notifications,
            nextCursor: last && hasMore ? last.id : null,
          };
        },

        unreadCount() {
          return newestFirst(userId).filter(
            (notification) => notification.readAt === null
          ).length;
        },

        markRead(notificationId) {
          const now = new Date().toISOString();
          for (const notification of newestFirst(userId)) {
            if (notification.id === notificationId) {
              notification.readAt ??= now;
            }
          }
        },

        markAllRead() {
          const now = new Date().toISOString();
          for (const notification of newestFirst(userId)) {
            notification.readAt ??= now;
          }
        },
      };
    },
  };
}

// ─── The configured provider ───

// On globalThis, so the dev server's module reloads don't empty the fake.
const shared = globalThis as typeof globalThis & {
  cadenceFakeNotificationProvider?: FakeNotificationProvider;
};

/** The fake Cadence is using, or null when a real provider is configured. */
export function configuredFakeNotificationProvider(): FakeNotificationProvider | null {
  if (process.env.KNOCK_API_KEY) return null;
  shared.cadenceFakeNotificationProvider ??= createFakeNotificationProvider(
    outboxTransport(".outbox")
  );
  return shared.cadenceFakeNotificationProvider;
}

/** Knock when KNOCK_API_KEY is set, and the fake otherwise. */
export function configuredNotificationProvider(): NotificationProvider {
  return (
    configuredFakeNotificationProvider() ??
    configuredKnockNotificationProvider()
  );
}
