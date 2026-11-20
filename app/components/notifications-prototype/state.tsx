// PROTOTYPE, throwaway. In-memory Notification Feed shared by the bell, the
// feed, the live pop-up, the Notification settings card and the switcher bar.
// A reload or a DevUI user switch starts it over.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PrototypeFeed, PrototypeNotification } from "./types";

type Arrival = {
  notification: PrototypeNotification;
  // False when the switch is off (unless the kind ignores it) or when the
  // feed is already on screen.
  popUp: boolean;
  nonce: number;
};

type NotificationsPrototype = {
  notifications: PrototypeNotification[];
  unreadCount: number;
  unseenCount: number;
  popUpsOn: boolean;
  setPopUpsOn: (on: boolean) => void;
  feedOpen: boolean;
  setFeedOpen: (open: boolean) => void;
  markRead: (id: string) => void;
  toggleRead: (id: string) => void;
  markAllRead: () => void;
  markAllSeen: () => void;
  canSend: boolean;
  sendNext: () => void;
  lastArrival: Arrival | null;
};

const Context = createContext<NotificationsPrototype | null>(null);

export function NotificationsPrototypeProvider({
  initial,
  children,
}: {
  initial: PrototypeFeed;
  children: React.ReactNode;
}) {
  const [notifications, setNotifications] = useState(initial.feed);
  const [popUpsOn, setPopUpsOn] = useState(true);
  const [feedOpen, setFeedOpen] = useState(false);
  const [lastArrival, setLastArrival] = useState<Arrival | null>(null);
  const sent = useRef(0);
  const upcoming = initial.upcoming;

  const markRead = useCallback((id: string) => {
    const now = new Date().toISOString();
    setNotifications((all) =>
      all.map((n) =>
        n.id === id ? { ...n, readAt: n.readAt ?? now, seenAt: n.seenAt ?? now } : n
      )
    );
  }, []);

  const toggleRead = useCallback((id: string) => {
    const now = new Date().toISOString();
    setNotifications((all) =>
      all.map((n) =>
        n.id === id
          ? { ...n, readAt: n.readAt ? null : now, seenAt: n.seenAt ?? now }
          : n
      )
    );
  }, []);

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setNotifications((all) =>
      all.map((n) => ({ ...n, readAt: n.readAt ?? now, seenAt: n.seenAt ?? now }))
    );
  }, []);

  const markAllSeen = useCallback(() => {
    const now = new Date().toISOString();
    setNotifications((all) => all.map((n) => ({ ...n, seenAt: n.seenAt ?? now })));
  }, []);

  const sendNext = useCallback(() => {
    if (upcoming.length === 0) return;
    const i = sent.current++;
    const template = upcoming[i % upcoming.length];
    const notification: PrototypeNotification = {
      ...template,
      id: `${template.id}-${i}`,
      insertedAt: new Date().toISOString(),
      seenAt: null,
      readAt: null,
    };
    setNotifications((all) => [notification, ...all]);
    setLastArrival({
      notification,
      popUp: (popUpsOn || notification.alwaysDelivered) && !feedOpen,
      nonce: i,
    });
  }, [upcoming, popUpsOn, feedOpen]);

  const value = useMemo<NotificationsPrototype>(
    () => ({
      notifications,
      unreadCount: notifications.filter((n) => !n.readAt).length,
      unseenCount: notifications.filter((n) => !n.seenAt).length,
      popUpsOn,
      setPopUpsOn,
      feedOpen,
      setFeedOpen,
      markRead,
      toggleRead,
      markAllRead,
      markAllSeen,
      canSend: upcoming.length > 0,
      sendNext,
      lastArrival,
    }),
    [
      notifications,
      popUpsOn,
      feedOpen,
      markRead,
      toggleRead,
      markAllRead,
      markAllSeen,
      upcoming.length,
      sendNext,
      lastArrival,
    ]
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useNotificationsPrototype() {
  const value = useContext(Context);
  if (!value) {
    throw new Error("useNotificationsPrototype needs NotificationsPrototypeProvider");
  }
  return value;
}

// Calls back once per live arrival that happens after the caller mounted, so
// switching variants doesn't replay the last pop-up.
export function useNewArrival(onArrival: (arrival: Arrival) => void) {
  const { lastArrival } = useNotificationsPrototype();
  const handled = useRef(lastArrival?.nonce);
  const callback = useRef(onArrival);
  callback.current = onArrival;
  useEffect(() => {
    if (!lastArrival || lastArrival.nonce === handled.current) return;
    handled.current = lastArrival.nonce;
    callback.current(lastArrival);
  }, [lastArrival]);
}

// For pages that only show the prototype when it's mounted (the settings card).
export function useOptionalNotificationsPrototype() {
  return useContext(Context);
}
