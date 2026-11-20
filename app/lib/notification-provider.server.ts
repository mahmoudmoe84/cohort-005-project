import type {
  FeedCredentials,
  Notification,
  NotificationActor,
  NotificationKind,
  SummaryPart,
} from "~/lib/notifications";

// ─── Notification Provider ───
// The outside service that stores and delivers Notifications sits behind this
// interface, modelled on MailTransport in mailer.server.ts (ADR 0013). Nothing
// outside the adapters knows which provider it is. Cadence writes all the
// wording, so a send carries finished text.
//
// Until the Knock adapter exists (#36), the only provider is the fake below,
// used whenever KNOCK_API_KEY is unset.

export type NotificationRecipient = { id: number; email: string };

export type NotificationContent = {
  summary: SummaryPart[];
  excerpt: string | null;
  context: string;
  url: string;
};

export type NotificationSend = {
  kind: NotificationKind;
  recipients: NotificationRecipient[];
  actor: NotificationActor | null;
  content: NotificationContent;
};

export interface NotificationProvider {
  /** Sends one Notification to every recipient and returns its workflow run id. */
  send(notification: NotificationSend): Promise<string>;
  /** What the browser adapter needs to connect to this person's Notification Feed. */
  feedCredentials(userId: number): Promise<FeedCredentials>;
}

// ─── The fake ───
// Keeps Notifications in memory: tests check what was sent, and the dev-only
// route api/fake-notification-feed serves each person's Notification Feed to
// the fake browser client.

const FEED_PAGE_SIZE = 20;

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
  /** Every send, oldest first. */
  readonly sent: NotificationSend[];
  /** One person's Notification Feed. */
  feedOf(userId: number): FakeNotificationFeed;
};

// Each recipient gets their own copy of a send, with its own read state.
type Delivered = {
  recipientId: number;
  notification: Notification;
};

export function createFakeNotificationProvider(): FakeNotificationProvider {
  const sent: NotificationSend[] = [];
  const delivered: Delivered[] = [];

  function newestFirst(userId: number) {
    return delivered
      .filter((copy) => copy.recipientId === userId)
      .map((copy) => copy.notification)
      .reverse();
  }

  return {
    sent,

    async send(notification) {
      sent.push(notification);
      const { summary, excerpt, context, url } = notification.content;
      const insertedAt = new Date().toISOString();
      for (const recipient of notification.recipients) {
        delivered.push({
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
      return `fake-run-${sent.length}`;
    },

    async feedCredentials(userId) {
      return { provider: "fake", userId };
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
  shared.cadenceFakeNotificationProvider ??= createFakeNotificationProvider();
  return shared.cadenceFakeNotificationProvider;
}

export function configuredNotificationProvider(): NotificationProvider {
  const fake = configuredFakeNotificationProvider();
  if (!fake) {
    throw new Error(
      "KNOCK_API_KEY is set, but Cadence has no Knock adapter yet (#36). " +
        "Unset it to use the fake Notification Provider."
    );
  }
  return fake;
}
