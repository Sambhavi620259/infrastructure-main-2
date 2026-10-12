"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellIcon } from "@heroicons/react/24/outline";
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "@/lib/notifications";

const POLL_MS = 60_000;

const DOT: Record<string, string> = {
  SUCCESS: "bg-emerald-500",
  WARNING: "bg-amber-500",
  INFO: "bg-brand-500",
};

function timeAgo(value: string): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (Number.isNaN(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/** Bell in the top bar: unread count (polled), the latest notifications, mark read. */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    getUnreadCount()
      .then(setUnread)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    listNotifications()
      .then(setItems)
      .catch(() => setItems([]));
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const openItem = async (item: AppNotification) => {
    if (!item.is_read) {
      await markNotificationRead(item.id).catch(() => undefined);
      setItems((current) => current?.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)) ?? null);
      setUnread((count) => Math.max(0, count - 1));
    }
    if (item.link) {
      setOpen(false);
      router.push(item.link);
    }
  };

  const readAll = async () => {
    await markAllNotificationsRead().catch(() => undefined);
    setItems((current) => current?.map((n) => ({ ...n, is_read: true })) ?? null);
    setUnread(0);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
      >
        <BellIcon className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
            <p className="font-bold text-slate-800">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={readAll} className="font-semibold text-brand-600 hover:text-brand-700">
                Mark all read
              </button>
            )}
          </div>
          {items === null ? (
            <p className="p-4 text-slate-500">Loading…</p>
          ) : items.length === 0 ? (
            <p className="p-4 text-slate-500">You&rsquo;re all caught up.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={`flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50 ${item.is_read ? "" : "bg-blue-50/40"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.is_read ? "bg-slate-200" : DOT[item.type] ?? DOT.INFO}`}
                    />
                    <span className="min-w-0">
                      <span className={`block ${item.is_read ? "text-slate-600" : "font-semibold text-slate-800"}`}>{item.title}</span>
                      {item.message && <span className="block truncate text-slate-500">{item.message}</span>}
                      <span className="block text-[10px] text-slate-400">{timeAgo(item.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
