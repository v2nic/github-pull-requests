"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AuthDialog from "@/components/AuthDialog";

interface PRNotification {
  title: string;
  reason: string;
  url: string;
  state?: string;
  html_url?: string;
  repository?: string;
  number?: number;
  headRef?: string;
  closedAt?: string;
  merged?: boolean;
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";
}

interface APIResponse {
  notifications: PRNotification[];
  total: number;
  error?: string;
  details?: string;
  cached?: boolean;
  backoff?: boolean;
}

const POLL_INTERVAL_MS = 60000;
const CACHE_KEY = "github-pr-notifications-cache";
const REFRESH_THROTTLE_MS = 60000;

export default function Home() {
  const [notifications, setNotifications] = useState<PRNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("open");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [copyToast, setCopyToast] = useState(false);
  const [isFromCache, setIsFromCache] = useState(false);
  const [isBackoff, setIsBackoff] = useState(false);
  const [backoffEndTime, setBackoffEndTime] = useState<number | null>(null);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const backoffTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isBackoffRef = useRef(false);

  // Debug logging for auth dialog state
  useEffect(() => {
    console.log("AuthDialog state changed:", showAuthDialog);
  }, [showAuthDialog]);

  const handleAuthSuccess = () => {
    setShowAuthDialog(false);
    setError(null);
    // Immediately fetch notifications after successful authentication
    fetchNotifications(true);
  };

  const handleAuthError = (errorMessage: string) => {
    setError(errorMessage);
    setShowAuthDialog(false);
  };

  const fetchNotifications = useCallback(
    async (isInitial = false) => {
      // Skip ENTIRELY if we're in backoff mode - no exceptions
      if (isBackoffRef.current) {
        return;
      }

      // Rate limit: skip if last refresh was less than REFRESH_THROTTLE_MS ago
      if (!isInitial && lastUpdated) {
        const timeSinceLastUpdate = Date.now() - lastUpdated.getTime();
        if (timeSinceLastUpdate < REFRESH_THROTTLE_MS) {
          return;
        }
      }

      if (!isInitial) {
        setRefreshing(true);
      }

      try {
        const response = await fetch("/api/notifications");
        const data: APIResponse = await response.json();

        if (data.error) {
          console.log(
            "API Error received:",
            data.error,
            "Details:",
            data.details
          );
          setError(data.error);
          setIsBackoff(!!data.backoff);

          // Check if this is an authentication error (check both error and details)
          const errorText = `${data.error} ${data.details || ""}`.toLowerCase();
          if (
            errorText.includes("not logged in") ||
            errorText.includes("authentication") ||
            errorText.includes("gh auth")
          ) {
            console.log("Authentication error detected, showing dialog");
            setShowAuthDialog(true);
          }

          // Set backoff end time if this is a rate limit error
          if (data.backoff) {
            const backoffEnd = Date.now() + 300000; // 5 minutes from now
            setBackoffEndTime(backoffEnd);

            // Clear any existing backoff timeout
            if (backoffTimeoutRef.current) {
              clearTimeout(backoffTimeoutRef.current);
            }

            // Set timeout to automatically clear backoff after 5 minutes
            backoffTimeoutRef.current = setTimeout(() => {
              setIsBackoff(false);
              setBackoffEndTime(null);
              setError(null);
            }, 300000);
          }
        } else {
          const now = new Date();
          setNotifications(data.notifications);
          // Only update lastUpdated for fresh data, not cached responses
          if (!data.cached) {
            setLastUpdated(now);
          }
          setIsFromCache(!!data.cached);
          setIsBackoff(false);
          setBackoffEndTime(null);
          setError(null);

          try {
            window.localStorage.setItem(
              CACHE_KEY,
              JSON.stringify({
                notifications: data.notifications,
                total: data.total,
                lastUpdated: now.toISOString(),
              })
            );
          } catch {}
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [lastUpdated]
  );

  useEffect(() => {
    let hasCache = false;

    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          notifications?: PRNotification[];
          total?: number;
          lastUpdated?: string;
        };

        if (Array.isArray(parsed.notifications)) {
          setNotifications(parsed.notifications);
          setLastUpdated(
            parsed.lastUpdated ? new Date(parsed.lastUpdated) : null
          );
          setLoading(false);
          setError(null);
          hasCache = true;
        }
      }
    } catch {}

    // Only fetch if not in backoff mode
    if (!isBackoffRef.current) {
      fetchNotifications(!hasCache);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isPolling || isBackoff) {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
      return;
    }

    const scheduleNextPoll = () => {
      pollTimeoutRef.current = setTimeout(() => {
        fetchNotifications(false).then(scheduleNextPoll);
      }, POLL_INTERVAL_MS);
    };

    scheduleNextPoll();

    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, [isPolling, isBackoff, fetchNotifications]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setIsPolling(false);
      } else {
        setIsPolling(true);
        // Only fetch if it's been more than 30 seconds since last fetch and not in backoff
        if (
          !isBackoff &&
          (!lastUpdated || Date.now() - lastUpdated.getTime() > 30000)
        ) {
          fetchNotifications(false);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchNotifications, lastUpdated, isBackoff]);

  // Cleanup backoff timeout on unmount
  useEffect(() => {
    return () => {
      if (backoffTimeoutRef.current) {
        clearTimeout(backoffTimeoutRef.current);
      }
    };
  }, []);

  // Sync ref with state
  useEffect(() => {
    isBackoffRef.current = isBackoff;
  }, [isBackoff]);

  // Update countdown timer every second during backoff
  useEffect(() => {
    if (!isBackoff || !backoffEndTime) return;

    const interval = setInterval(() => {
      // Force re-render to update countdown
      const now = Date.now();
      if (now >= backoffEndTime) {
        setIsBackoff(false);
        setBackoffEndTime(null);
        setError(null);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isBackoff, backoffEndTime]);

  const formatLastUpdated = () => {
    if (!lastUpdated) return "";
    const seconds = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes === 1) return "1 minute ago";
    return `${minutes} minutes ago`;
  };

  const getBackoffTimeRemaining = () => {
    if (!backoffEndTime) return null;
    const remaining = Math.max(0, backoffEndTime - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    if (minutes > 0) {
      return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${seconds}s`;
  };

  const isThrottled = () => {
    if (!lastUpdated) return false;
    const timeSinceLastUpdate = Date.now() - lastUpdated.getTime();
    return timeSinceLastUpdate < REFRESH_THROTTLE_MS;
  };

  const shouldDisableRefresh = () => {
    return refreshing || isThrottled() || isBackoff;
  };

  const filteredNotifications = notifications.filter((n) => {
    if (filter === "all") return true;
    if (filter === "open") return n.state === "open";
    if (filter === "closed")
      return n.state === "closed" || n.state === "merged" || n.merged;
    return true;
  });

  const sortedNotifications = [...filteredNotifications];

  if (filter === "closed") {
    sortedNotifications.sort((a, b) => {
      const aTime = a.closedAt ? new Date(a.closedAt).getTime() : 0;
      const bTime = b.closedAt ? new Date(b.closedAt).getTime() : 0;
      return bTime - aTime;
    });
  }

  const getStateColor = (state?: string, merged?: boolean) => {
    if (merged) {
      return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
    }
    switch (state) {
      case "open":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "closed":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
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
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Pull Requests
            </h1>
            <div className="flex items-center gap-3">
              {refreshing && (
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
                  <span>Refreshing...</span>
                </div>
              )}
              {isBackoff && !refreshing && (
                <div className="flex items-center gap-2 text-sm text-orange-600 dark:text-orange-400">
                  <div className="h-4 w-4 rounded-full border-2 border-orange-600"></div>
                  <span>
                    Rate limited (backoff active: {getBackoffTimeRemaining()}{" "}
                    remaining)
                  </span>
                </div>
              )}
              {isThrottled() && !refreshing && !isBackoff && (
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                  <div className="h-4 w-4 rounded-full border-2 border-gray-400"></div>
                  <span>Rate limited</span>
                </div>
              )}
              <button
                onClick={() => fetchNotifications(false)}
                disabled={shouldDisableRefresh()}
                className="rounded-lg bg-gray-100 p-2 text-gray-600 transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                title={
                  isBackoff
                    ? "Rate limit exceeded. Please wait before trying again."
                    : isThrottled()
                    ? "Please wait before refreshing again"
                    : "Refresh now"
                }
              >
                <svg
                  className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>
          </div>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Pull requests from your GitHub notifications
            {lastUpdated && (
              <span className="ml-2 text-sm">
                · Updated {formatLastUpdated()}
                {isFromCache && (
                  <span className="ml-1 text-green-600 dark:text-green-400">
                    · From cache
                  </span>
                )}
                {isBackoff && (
                  <span className="ml-1 text-orange-600 dark:text-orange-400">
                    · Rate limit protection active
                  </span>
                )}
                {!isBackoff && isPolling && " · Auto-refresh on"}
              </span>
            )}
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
                        : n.state === "closed" ||
                          n.state === "merged" ||
                          n.merged
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
          <div
            className={`rounded-lg p-4 ${
              isBackoff
                ? "bg-orange-50 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200"
                : "bg-red-50 text-red-800 dark:bg-red-900/50 dark:text-red-200"
            }`}
          >
            <p className="font-medium">
              {isBackoff
                ? "Rate Limit Protection Active"
                : "Error loading notifications"}
            </p>
            <p className="text-sm">{error}</p>
            {isBackoff ? (
              <p className="mt-2 text-sm">
                The application is automatically backing off to avoid exceeding
                GitHub API limits. Please wait a few minutes before trying
                again.
              </p>
            ) : (
              <p className="mt-2 text-sm">
                Make sure{" "}
                <code className="rounded bg-red-100 px-1 dark:bg-red-800">
                  gh
                </code>{" "}
                CLI is installed and authenticated.
              </p>
            )}
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
          {sortedNotifications.map((notification, index) => (
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
                    {notification.number
                      ? `#${notification.number} ${notification.title}`
                      : notification.title}
                  </h3>
                  {(notification.repository || notification.headRef) && (
                    <p className="mt-1 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                      {notification.repository && (
                        <span className="truncate">
                          {notification.repository}
                        </span>
                      )}
                      {notification.headRef && (
                        <button
                          type="button"
                          onClick={async (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            await navigator.clipboard.writeText(
                              notification.headRef ?? ""
                            );
                            setCopyToast(true);
                            setTimeout(() => setCopyToast(false), 2000);
                          }}
                          className="cursor-pointer rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                        >
                          {notification.headRef}
                        </button>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${getStateColor(
                      notification.state,
                      notification.merged
                    )}`}
                  >
                    {notification.merged
                      ? "merged"
                      : notification.state || "unknown"}
                  </span>
                  {notification.reviewDecision === "APPROVED" && (
                    <span
                      className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[10px] font-bold text-white"
                      aria-label="Approved"
                      title="Approved"
                    >
                      ✓
                    </span>
                  )}
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

      {/* Copy toast */}
      {copyToast && (
        <div className="fixed bottom-4 right-4 rounded bg-gray-900 px-3 py-2 text-sm text-white dark:bg-gray-100 dark:text-gray-900">
          Copied!
        </div>
      )}

      {showAuthDialog && (
        <AuthDialog
          isOpen={showAuthDialog}
          onClose={() => setShowAuthDialog(false)}
          onSuccess={handleAuthSuccess}
          onError={handleAuthError}
        />
      )}
    </div>
  );
}
