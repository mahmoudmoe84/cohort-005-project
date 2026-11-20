import { z } from "zod";

// ─── Notifications ───
// Cadence's own Notification types, shared by the server and the browser.
// Whichever Notification Provider sits behind Cadence's interfaces (ADR 0013),
// these are the only shapes the rest of Cadence sees. See GLOSSARY.md for the
// language. The pieces the adapters have in common live here too, because
// nothing here belongs to one provider.

export const NOTIFICATION_KINDS = [
  "refund-request-decided",
  "open-refund-request",
  "seat-claimed",
  "discussion-question",
  "discussion-reply",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** One run of a Notification's summary. Names are strong. */
export type SummaryPart = { text: string; strong?: boolean };

/** A summary as plain text, with nothing strong. */
export function summaryText(summary: SummaryPart[]): string {
  return summary.map((part) => part.text).join("");
}

/** Who did the thing. A null actor means Cadence itself. */
export type NotificationActor = { name: string; avatarUrl: string | null };

export type Notification = {
  id: string;
  kind: NotificationKind;
  actor: NotificationActor | null;
  summary: SummaryPart[];
  excerpt: string | null;
  /** Where it happened, such as the course's title. */
  context: string;
  url: string;
  insertedAt: string;
  readAt: string | null;
};

/** The Notification settings page, which holds the switch for email and pop-ups. */
export const NOTIFICATION_SETTINGS_URL = "/settings/notifications";

// Whether each kind of Notification ignores the person's switch for email and
// pop-ups. Only Refund Request decided does, because it carries the money
// details (ADR 0013).
const IGNORES_SWITCH = {
  "refund-request-decided": true,
  "open-refund-request": false,
  "seat-claimed": false,
  "discussion-question": false,
  "discussion-reply": false,
} satisfies Record<NotificationKind, boolean>;

/**
 * Whether email and pop-ups are on for a kind of Notification, given the
 * person's switch. The server asks before it emails, and the browser before it
 * pops one up.
 */
export function emailAndPopUpsOn(
  kind: NotificationKind,
  emailAndPopUps: boolean
): boolean {
  return emailAndPopUps || IGNORES_SWITCH[kind];
}

/**
 * What the browser needs to connect to one person's Notification Feed. The
 * Notification Provider's server adapter makes it, and the matching browser
 * adapter parses it with zod. Everything in between, the layout included,
 * passes it on without reading inside it, so its type says nothing about
 * what's there (ADR 0013).
 */
export type FeedCredentials = object;

// ─── Shared by the adapters ───

/** How many Notifications the Notification Feed loads at a time. */
export const NOTIFICATION_FEED_PAGE_SIZE = 20;

/** A Notification's summary, as a browser adapter reads it back. */
export const summarySchema = z.array(
  z.object({ text: z.string(), strong: z.boolean().optional() })
) satisfies z.ZodType<SummaryPart[]>;

/**
 * Who a Notification Feed client tells about arrivals: the callbacks given to
 * its onArrival.
 */
export function arrivalCallbacks() {
  const callbacks = new Set<(notification: Notification) => void>();

  return {
    /** The client's onArrival. Returns a function that stops the callback. */
    onArrival(callback: (notification: Notification) => void): () => void {
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },

    /** Calls back once for each Notification, in the order given. */
    arrived(notifications: Notification[]): void {
      for (const notification of notifications) {
        for (const callback of callbacks) callback(notification);
      }
    },

    /** Stops every callback, as the client's disconnect does. */
    clear(): void {
      callbacks.clear();
    },
  };
}
