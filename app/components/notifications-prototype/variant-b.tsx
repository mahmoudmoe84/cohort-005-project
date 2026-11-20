// PROTOTYPE, throwaway. Variant B, "Top bar + side panel": Cadence grows the
// header the bell was imagined in. A slim bar sits across the top of every
// page with the bell on the right. The badge counts UNREAD, so opening the
// panel doesn't clear it; only reading does. The Notification Feed is a
// full-height panel from the right, opening on Unread, grouped by day, with
// the quoted text inline and a per-item read toggle. The live pop-up drops
// out of the bell itself. Built headless (Knock hooks + Tailwind), so no Knock
// branding.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Dialog } from "radix-ui";
import { Bell, CheckCheck, Circle, CircleDot, Settings, X } from "lucide-react";
import { cn } from "~/lib/utils";
import { useNewArrival, useNotificationsPrototype } from "./state";
import { KindIcon, PopUpsOffNotice, Summary, timeAgo } from "./shared";
import type { PrototypeNotification } from "./types";

type Tab = "unread" | "all";

function dayGroup(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  if (date >= startOfToday) return "Today";
  if (date >= startOfYesterday) return "Yesterday";
  return "Earlier";
}

export function VariantBTopBar() {
  const prototype = useNotificationsPrototype();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("unread");
  const [popUp, setPopUp] = useState<PrototypeNotification | null>(null);
  const [ringing, setRinging] = useState(false);

  useNewArrival((arrival) => {
    setRinging(true);
    if (arrival.popUp) setPopUp(arrival.notification);
  });

  useEffect(() => {
    if (!ringing) return;
    const timer = setTimeout(() => setRinging(false), 1200);
    return () => clearTimeout(timer);
  }, [ringing]);

  useEffect(() => {
    if (!popUp) return;
    const timer = setTimeout(() => setPopUp(null), 7000);
    return () => clearTimeout(timer);
  }, [popUp]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    prototype.setFeedOpen(next);
    if (next) setPopUp(null);
  }

  function follow(n: PrototypeNotification) {
    prototype.markRead(n.id);
    onOpenChange(false);
    setPopUp(null);
    navigate(n.url);
  }

  const items = prototype.notifications.filter((n) =>
    tab === "all" ? true : !n.readAt
  );
  const groups = ["Today", "Yesterday", "Earlier"]
    .map((label) => ({
      label,
      items: items.filter((n) => dayGroup(n.insertedAt) === label),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="sticky top-0 z-30 flex h-14 items-center justify-end gap-2 border-b bg-background/95 px-6 backdrop-blur">
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            aria-label={`Notifications, ${prototype.unreadCount} unread`}
            className="relative flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            <Bell className={cn("size-4", ringing && "animate-bounce")} />
            {prototype.unreadCount > 0 ? (
              <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                {prototype.unreadCount}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">0</span>
            )}
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[440px] max-w-full flex-col border-l bg-background shadow-2xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right">
            <div className="flex items-center gap-2 border-b px-5 py-4">
              <Dialog.Title className="text-base font-semibold">
                Notifications
              </Dialog.Title>
              <button
                type="button"
                onClick={prototype.markAllRead}
                disabled={prototype.unreadCount === 0}
                className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
              >
                <CheckCheck className="size-3.5" />
                Mark all read
              </button>
              <Dialog.Close className="rounded-md p-1 hover:bg-accent" aria-label="Close">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Your Notifications, newest first.
            </Dialog.Description>

            <div className="flex gap-1 border-b px-5 py-2">
              {(["unread", "all"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium",
                    tab === key
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  {key === "unread"
                    ? `Unread (${prototype.unreadCount})`
                    : `All (${prototype.notifications.length})`}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {!prototype.popUpsOn && <PopUpsOffNotice className="mb-4" />}
              {groups.length === 0 ? (
                <div className="py-16 text-center">
                  <CheckCheck className="mx-auto mb-3 size-8 text-muted-foreground" />
                  <p className="text-sm font-medium">You're all caught up</p>
                  {tab === "unread" && (
                    <button
                      type="button"
                      onClick={() => setTab("all")}
                      className="mt-2 text-xs text-primary hover:underline"
                    >
                      See all Notifications
                    </button>
                  )}
                </div>
              ) : (
                groups.map((group) => (
                  <section key={group.label} className="mb-6">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {group.label}
                    </h3>
                    <div className="space-y-2">
                      {group.items.map((n) => (
                        <div
                          key={n.id}
                          className={cn(
                            "group relative rounded-lg border p-3 transition-colors hover:border-foreground/20",
                            !n.readAt && "border-primary/30 bg-primary/5"
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => follow(n)}
                            className="flex w-full gap-3 text-left"
                          >
                            <KindIcon kind={n.kind} />
                            <span className="min-w-0 flex-1 pr-6">
                              <Summary
                                notification={n}
                                className="block text-sm text-muted-foreground"
                              />
                              {n.excerpt && (
                                <span className="mt-2 line-clamp-2 block border-l-2 pl-2 text-xs italic text-muted-foreground">
                                  {n.excerpt}
                                </span>
                              )}
                              <span className="mt-2 block text-xs text-muted-foreground">
                                {n.context} · {timeAgo(n.insertedAt)}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => prototype.toggleRead(n.id)}
                            title={n.readAt ? "Mark as unread" : "Mark as read"}
                            className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            {n.readAt ? (
                              <Circle className="size-3.5" />
                            ) : (
                              <CircleDot className="size-3.5 text-primary" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>

            <div className="border-t px-5 py-3">
              <Link
                to="/settings#notifications"
                onClick={() => onOpenChange(false)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Settings className="size-3.5" />
                Notification settings
              </Link>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {popUp && (
        <div className="absolute right-4 top-full mt-2 w-80 rounded-lg border bg-popover p-3 shadow-xl animate-in fade-in slide-in-from-top-2">
          <div className="flex gap-3">
            <KindIcon kind={popUp.kind} />
            <div className="min-w-0 flex-1">
              <Summary
                notification={popUp}
                className="block text-sm text-muted-foreground"
              />
              {popUp.excerpt && (
                <p className="mt-1 line-clamp-2 text-xs italic text-muted-foreground">
                  {popUp.excerpt}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => follow(popUp)}
                  className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => setPopUp(null)}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
