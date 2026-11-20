// PROTOTYPE, throwaway. Variant A, "Knock's popover": what Cadence gets by
// dropping in Knock's prebuilt NotificationIconButton + NotificationFeedPopover
// and theming it. CHOSEN in issue #17, with one change from Knock's defaults:
//   - the badge counts UNREAD (badgeCountType="unread"), so it drops only when
//     a Notification is read, never just because the popover was opened.
//     (Knock's default counts unseen and clears on open; that was rejected.)
// Otherwise the structure follows Knock's defaults on purpose:
//   - a header with an All / Unread / Read filter and "Mark all as read";
//   - cells: actor avatar, rendered body, time, unread dot; a click marks it
//     read and follows its action URL;
//   - "Powered by Knock" stays on the free plan (branding removal is paid).
// Knock ships no toast, so the live pop-up is Cadence's own sonner toast.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Popover } from "radix-ui";
import { toast } from "sonner";
import { Bell, Settings, Zap } from "lucide-react";
import { cn } from "~/lib/utils";
import { useNewArrival, useNotificationsPrototype } from "./state";
import {
  NotificationAvatar,
  PopUpsOffNotice,
  Summary,
  timeAgo,
} from "./shared";

type Filter = "all" | "unread" | "read";

export function VariantABell() {
  const prototype = useNotificationsPrototype();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  useNewArrival((arrival) => {
    if (!arrival.popUp) return;
    const n = arrival.notification;
    toast(<Summary notification={n} className="text-sm" />, {
      id: n.id,
      description: n.context,
      icon: <NotificationAvatar notification={n} className="size-6 text-[10px]" />,
      action: {
        label: "View",
        onClick: () => {
          prototype.markRead(n.id);
          navigate(n.url);
        },
      },
      duration: 6000,
    });
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    prototype.setFeedOpen(next);
    if (next) prototype.markAllSeen();
  }

  const items = prototype.notifications.filter((n) =>
    filter === "all" ? true : filter === "unread" ? !n.readAt : !!n.readAt
  );

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Notifications, ${prototype.unreadCount} unread`}
          className="relative rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Bell className="size-4" />
          {prototype.unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
              {prototype.unreadCount > 9 ? "9+" : prototype.unreadCount}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={12}
          className="z-50 flex max-h-[min(560px,80vh)] w-[380px] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
        >
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              className="rounded border bg-background px-1.5 py-0.5 text-xs"
              aria-label="Show"
            >
              <option value="all">All</option>
              <option value="unread">Unread</option>
              <option value="read">Read</option>
            </select>
            <button
              type="button"
              onClick={prototype.markAllRead}
              disabled={prototype.unreadCount === 0}
              className="ml-auto text-xs font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-40"
            >
              Mark all as read
            </button>
          </div>

          {!prototype.popUpsOn && <PopUpsOffNotice className="m-3 mb-0" />}

          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                You're all caught up.
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    prototype.markRead(n.id);
                    onOpenChange(false);
                    navigate(n.url);
                  }}
                  className="flex w-full gap-3 border-b px-4 py-3 text-left text-sm transition-colors last:border-b-0 hover:bg-accent"
                >
                  <span
                    className={cn(
                      "mt-3 size-2 shrink-0 rounded-full",
                      n.readAt ? "bg-transparent" : "bg-blue-600"
                    )}
                  />
                  <NotificationAvatar notification={n} />
                  <span className="min-w-0 flex-1">
                    <Summary
                      notification={n}
                      className="block text-muted-foreground"
                    />
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {timeAgo(n.insertedAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
            <Link
              to="/settings#notifications"
              onClick={() => onOpenChange(false)}
              className="flex items-center gap-1 hover:text-foreground"
            >
              <Settings className="size-3" />
              Notification settings
            </Link>
            <span className="flex items-center gap-1">
              <Zap className="size-3" />
              Powered by Knock
            </span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
