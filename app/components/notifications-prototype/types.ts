// PROTOTYPE, throwaway. See ./index.tsx for what this prototype is answering.
// The shape loosely follows a Knock feed item (actor, rendered body, action URL,
// seen_at / read_at), so whatever wins here is buildable on Knock's hooks.

export type NotificationKind =
  | "refund-request-decided"
  | "open-refund-request"
  | "seat-claimed"
  | "discussion-question"
  | "discussion-reply";

export type SummaryPart = { text: string; strong?: boolean };

export type PrototypeNotification = {
  id: string;
  kind: NotificationKind;
  // Who did it. Null means Cadence itself (a Refund Request decision is
  // signed "we", never by the Platform Admin's name).
  actor: { name: string; avatarUrl: string | null } | null;
  summary: SummaryPart[];
  // Quoted text: the Discussion Question or Reply, the refund reason, or the
  // Platform Admin's note.
  excerpt: string | null;
  context: string;
  url: string;
  insertedAt: string;
  seenAt: string | null;
  readAt: string | null;
  // Refund Request decided ignores the person's switch.
  alwaysDelivered: boolean;
};

export type PrototypeFeed = {
  feed: PrototypeNotification[];
  // Queued for the "Send a Notification" button, to fake a live arrival.
  upcoming: PrototypeNotification[];
};

export const KIND_LABELS: Record<NotificationKind, string> = {
  "refund-request-decided": "Refund decision",
  "open-refund-request": "Refund Request",
  "seat-claimed": "Seat claimed",
  "discussion-question": "Discussion Question",
  "discussion-reply": "Discussion Reply",
};

export const PROTOTYPE_VARIANTS = [
  { key: "A", name: "Knock's popover" },
  { key: "B", name: "Top bar + side panel" },
  { key: "C", name: "Sidebar item + page" },
] as const;

export type PrototypeVariantKey = (typeof PROTOTYPE_VARIANTS)[number]["key"];

export const PROTOTYPE_VARIANT_COOKIE = "notifications-prototype-variant";
