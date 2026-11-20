// PROTOTYPE, throwaway. Variant C, "Sidebar item + page": no bell at all.
// Cadence has no header, its navigation is the sidebar, so Notifications
// become the first sidebar item with an unread count, like a mail client.
// The Notification Feed is a full page (dense rows, filter by kind, a read
// toggle per row). The live pop-up is a callout pointing at the sidebar item,
// so people learn where Notifications live. Headless, no Knock branding.
import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { Bell, CheckCheck, Circle, CircleDot, Settings, X } from "lucide-react";
import { cn } from "~/lib/utils";
import { useNewArrival, useNotificationsPrototype } from "./state";
import {
  NotificationAvatar,
  PopUpsOffNotice,
  Summary,
  timeAgo,
} from "./shared";
import {
  KIND_LABELS,
  type NotificationKind,
  type PrototypeNotification,
} from "./types";

export const VARIANT_C_PATH = "/prototype/notifications";

export function VariantCNavItem() {
  const prototype = useNotificationsPrototype();
  const navigate = useNavigate();
  const [popUp, setPopUp] = useState<PrototypeNotification | null>(null);

  useNewArrival((arrival) => {
    if (arrival.popUp) setPopUp(arrival.notification);
  });

  useEffect(() => {
    if (!popUp) return;
    const timer = setTimeout(() => setPopUp(null), 7000);
    return () => clearTimeout(timer);
  }, [popUp]);

  // Opening the Notifications page answers the callout.
  useEffect(() => {
    if (prototype.feedOpen) setPopUp(null);
  }, [prototype.feedOpen]);

  return (
    <div className="relative">
      <NavLink
        to={VARIANT_C_PATH}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            popUp && "ring-2 ring-primary/50"
          )
        }
      >
        <Bell className="size-4" />
        Notifications
        {prototype.unreadCount > 0 && (
          <span className="ml-auto rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground">
            {prototype.unreadCount}
          </span>
        )}
      </NavLink>

      {popUp && (
        <div className="absolute left-full top-0 z-50 ml-3 w-80 rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl animate-in fade-in slide-in-from-left-2">
          <span className="absolute -left-1.5 top-3 size-3 rotate-45 border-b border-l bg-popover" />
          <div className="flex gap-3">
            <NotificationAvatar notification={popUp} />
            <div className="min-w-0 flex-1">
              <Summary
                notification={popUp}
                className="block text-sm text-muted-foreground"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {popUp.context} · just now
              </p>
              <div className="mt-2 flex gap-3 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => {
                    prototype.markRead(popUp.id);
                    setPopUp(null);
                    navigate(popUp.url);
                  }}
                  className="text-primary hover:underline"
                >
                  View
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPopUp(null);
                    navigate(VARIANT_C_PATH);
                  }}
                  className="text-muted-foreground hover:underline"
                >
                  All Notifications
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPopUp(null)}
              aria-label="Dismiss"
              className="self-start rounded p-0.5 text-muted-foreground hover:bg-accent"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type KindFilter = "all" | "unread" | "refunds" | "seats" | "discussions";

const KIND_FILTERS: Record<Exclude<KindFilter, "all" | "unread">, NotificationKind[]> = {
  refunds: ["refund-request-decided", "open-refund-request"],
  seats: ["seat-claimed"],
  discussions: ["discussion-question", "discussion-reply"],
};

export function VariantCPage() {
  const prototype = useNotificationsPrototype();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<KindFilter>("all");
  const { setFeedOpen } = prototype;

  // The feed is on screen, so no pop-up while this page is open.
  useEffect(() => {
    setFeedOpen(true);
    return () => setFeedOpen(false);
  }, [setFeedOpen]);

  const kindsPresent = new Set(prototype.notifications.map((n) => n.kind));
  const filters = (
    [
      ["all", `All (${prototype.notifications.length})`],
      ["unread", `Unread (${prototype.unreadCount})`],
      ["refunds", "Refunds"],
      ["seats", "Seats"],
      ["discussions", "Discussions"],
    ] as const
  ).filter(
    ([key]) =>
      key === "all" ||
      key === "unread" ||
      KIND_FILTERS[key].some((kind) => kindsPresent.has(kind))
  );

  const items = prototype.notifications.filter((n) =>
    filter === "all"
      ? true
      : filter === "unread"
        ? !n.readAt
        : KIND_FILTERS[filter].includes(n.kind)
  );

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="mt-1 text-muted-foreground">
            Everything Cadence has told you about, newest first.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/settings#notifications"
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <Settings className="size-4" />
            Settings
          </Link>
          <button
            type="button"
            onClick={prototype.markAllRead}
            disabled={prototype.unreadCount === 0}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            <CheckCheck className="size-4" />
            Mark all read
          </button>
        </div>
      </div>

      {!prototype.popUpsOn && <PopUpsOffNotice className="mb-4" />}

      <div className="mb-3 flex flex-wrap gap-2">
        {filters.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-md border px-3 py-1 text-sm",
              filter === key
                ? "border-foreground bg-foreground text-background"
                : "hover:bg-accent"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border">
        {items.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            Nothing here. When something that concerns you happens on Cadence,
            it shows up on this page.
          </div>
        ) : (
          items.map((n) => (
            <div
              key={n.id}
              className={cn(
                "flex items-center gap-4 border-b px-4 py-3 last:border-b-0",
                !n.readAt && "bg-primary/5"
              )}
            >
              <button
                type="button"
                onClick={() => prototype.toggleRead(n.id)}
                title={n.readAt ? "Mark as unread" : "Mark as read"}
                className="rounded p-1 text-muted-foreground hover:bg-accent"
              >
                {n.readAt ? (
                  <Circle className="size-3.5" />
                ) : (
                  <CircleDot className="size-3.5 text-primary" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  prototype.markRead(n.id);
                  navigate(n.url);
                }}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <NotificationAvatar notification={n} />
                <span className="min-w-0 flex-1">
                  <Summary
                    notification={n}
                    className={cn(
                      "block truncate text-sm",
                      n.readAt ? "text-muted-foreground" : "text-foreground"
                    )}
                  />
                  {n.excerpt && (
                    <span className="block truncate text-xs text-muted-foreground">
                      “{n.excerpt}”
                    </span>
                  )}
                </span>
              </button>
              <span className="hidden w-36 shrink-0 text-xs text-muted-foreground md:block">
                {KIND_LABELS[n.kind]}
              </span>
              <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                {timeAgo(n.insertedAt)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
