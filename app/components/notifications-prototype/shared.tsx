// PROTOTYPE, throwaway. Small pieces the variants share. Layout is never shared:
// each variant owns its own structure.
import { Link } from "react-router";
import {
  MessageSquare,
  MessageSquareReply,
  Receipt,
  ReceiptText,
  UsersRound,
} from "lucide-react";
import { UserAvatar } from "~/components/user-avatar";
import { cn, formatRelativeTime } from "~/lib/utils";
import type { NotificationKind, PrototypeNotification } from "./types";

export function Summary({
  notification,
  className,
}: {
  notification: PrototypeNotification;
  className?: string;
}) {
  return (
    <span className={className}>
      {notification.summary.map((part, i) =>
        part.strong ? (
          <strong key={i} className="font-semibold text-foreground">
            {part.text}
          </strong>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </span>
  );
}

export function NotificationAvatar({
  notification,
  className,
}: {
  notification: PrototypeNotification;
  className?: string;
}) {
  if (!notification.actor) {
    // Cadence itself: a Refund Request decision is signed "we".
    return (
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground",
          className
        )}
      >
        C
      </div>
    );
  }
  return (
    <UserAvatar
      name={notification.actor.name}
      avatarUrl={notification.actor.avatarUrl}
      className={cn("shrink-0", className)}
    />
  );
}

const KIND_STYLES: Record<
  NotificationKind,
  { icon: typeof Receipt; className: string }
> = {
  "refund-request-decided": {
    icon: ReceiptText,
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  },
  "open-refund-request": {
    icon: Receipt,
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  "seat-claimed": {
    icon: UsersRound,
    className:
      "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  },
  "discussion-question": {
    icon: MessageSquare,
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  "discussion-reply": {
    icon: MessageSquareReply,
    className: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  },
};

export function KindIcon({
  kind,
  className,
}: {
  kind: NotificationKind;
  className?: string;
}) {
  const { icon: Icon, className: tone } = KIND_STYLES[kind];
  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full",
        tone,
        className
      )}
    >
      <Icon className="size-4" />
    </div>
  );
}

export function timeAgo(iso: string) {
  return formatRelativeTime(iso);
}

export function PopUpsOffNotice({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground",
        className
      )}
    >
      Email and pop-ups are off. Notifications still collect here.{" "}
      <Link to="/settings#notifications" className="font-medium underline">
        Change
      </Link>
    </div>
  );
}
