"use client";

import { useEffect, useState } from "react";

interface PRNotification {
  title: string;
  reason: string;
  url: string;
  state?: string;
  html_url?: string;
  repository?: string;
}

interface APIResponse {
  notifications: PRNotification[];
  total: number;
  error?: string;
}

export default function Home() {
  const [notifications, setNotifications] = useState<PRNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("open");

  useEffect(() => {
    async function fetchNotifications() {
      try {
        const response = await fetch("/api/notifications");
        const data: APIResponse = await response.json();

        if (data.error) {
          setError(data.error);
        } else {
          setNotifications(data.notifications);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch");
      } finally {
        setLoading(false);
      }
    }

    fetchNotifications();
  }, []);

  const filteredNotifications = notifications.filter((n) => {
    if (filter === "all") return true;
    if (filter === "open") return n.state === "open";
    if (filter === "closed")
      return n.state === "closed" || n.state === "merged";
    return true;
  });

  const getStateColor = (state?: string) => {
    switch (state) {
      case "open":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "closed":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      case "merged":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
    }
  };

  const getReasonLabel = (reason: string) => {
    const labels: Record<string, string> = {
      subscribed: "Subscribed",
      manual: "Manually subscribed",
      author: "Author",
      comment: "Commented",
      commenter: "Commented",
      mention: "Mentioned",
      team_mention: "Team mentioned",
      state_change: "State changed",
      assign: "Assigned",
      review_requested: "Review requested",
      reviewed: "Reviewed",
    };
    return labels[reason] || reason;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            My Pull Request Subscriptions
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Pull requests from your GitHub notifications
          </p>
        </header>

        <div className="mb-6 flex gap-2">
          {(["all", "open", "closed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                filter === f
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f !== "all" && (
                <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-xs">
                  {
                    notifications.filter((n) =>
                      f === "open"
                        ? n.state === "open"
                        : n.state === "closed" || n.state === "merged"
                    ).length
                  }
                </span>
              )}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
            <span className="ml-3 text-gray-600 dark:text-gray-400">
              Loading notifications...
            </span>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-red-800 dark:bg-red-900/50 dark:text-red-200">
            <p className="font-medium">Error loading notifications</p>
            <p className="text-sm">{error}</p>
            <p className="mt-2 text-sm">
              Make sure{" "}
              <code className="rounded bg-red-100 px-1 dark:bg-red-800">
                gh
              </code>{" "}
              CLI is installed and authenticated.
            </p>
          </div>
        )}

        {!loading && !error && filteredNotifications.length === 0 && (
          <div className="rounded-lg bg-white p-8 text-center shadow dark:bg-gray-800">
            <p className="text-gray-600 dark:text-gray-400">
              No {filter !== "all" ? filter : ""} pull requests found.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {filteredNotifications.map((notification, index) => (
            <a
              key={index}
              href={notification.html_url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg bg-white p-4 shadow transition-shadow hover:shadow-md dark:bg-gray-800"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-medium text-gray-900 dark:text-white">
                    {notification.title}
                  </h3>
                  {notification.repository && (
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {notification.repository}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${getStateColor(
                      notification.state
                    )}`}
                  >
                    {notification.state || "unknown"}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {getReasonLabel(notification.reason)}
                  </span>
                </div>
              </div>
            </a>
          ))}
        </div>

        {!loading && !error && (
          <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Showing {filteredNotifications.length} of {notifications.length}{" "}
            pull requests
          </p>
        )}
      </div>
    </div>
  );
}
