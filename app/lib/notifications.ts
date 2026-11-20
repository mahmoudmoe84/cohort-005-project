// ─── Notifications ───
// Cadence's own Notification types, shared by the server and the browser.
// Whichever Notification Provider sits behind Cadence's interfaces (ADR 0013),
// these are the only shapes the rest of Cadence sees. See GLOSSARY.md for the
// language.

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

/**
 * What the browser needs to connect to one person's Notification Feed. The
 * Notification Provider's server adapter makes it, and the matching browser
 * adapter parses it with zod. Everything in between, the layout included,
 * passes it on without reading inside it, so its type says nothing about
 * what's there (ADR 0013).
 */
export type FeedCredentials = object;
