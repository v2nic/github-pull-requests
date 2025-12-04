"use client";

import { useState, useEffect, useRef } from "react";

interface AuthDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onError: (error: string) => void;
}

interface AuthStatus {
  code?: string;
  url?: string;
  status: "starting" | "waiting" | "completed" | "error";
  message?: string;
}

export default function AuthDialog({
  isOpen,
  onClose,
  onSuccess,
  onError,
}: AuthDialogProps) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>({
    status: "starting",
  });
  const [sessionId] = useState(
    () => `auth-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  );
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isOpen) {
      // Cleanup when dialog closes
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    // Start authentication process
    startAuthentication();

    return () => {
      // Cleanup on unmount
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [isOpen]);

  const startAuthentication = async () => {
    try {
      // Start the authentication process via POST
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to start authentication: ${response.statusText}`
        );
      }

      // Set up Server-Sent Events via GET
      const eventSource = new EventSource(
        `/api/auth/login?sessionId=${sessionId}&action=start`
      );
      eventSourceRef.current = eventSource;

      eventSource.addEventListener("start", (event) => {
        const data = JSON.parse((event as MessageEvent).data);
        setAuthStatus({ status: "starting", message: data.message });
      });

      eventSource.addEventListener("code", (event) => {
        const data = JSON.parse((event as MessageEvent).data);
        setAuthStatus((prev) => ({
          ...prev,
          code: data.code,
          status: "waiting",
        }));
      });

      eventSource.addEventListener("url", (event) => {
        const data = JSON.parse((event as MessageEvent).data);
        setAuthStatus((prev) => ({
          ...prev,
          url: data.url,
          status: "waiting",
        }));
      });

      eventSource.addEventListener("success", (event) => {
        const data = JSON.parse((event as MessageEvent).data);
        setAuthStatus({ status: "completed", message: data.message });
        onSuccess();
        setTimeout(() => onClose(), 2000);
      });

      eventSource.addEventListener("error", (event) => {
        const data = JSON.parse((event as MessageEvent).data);
        setAuthStatus({ status: "error", message: data.message });
        onError(data.message);
      });

      eventSource.addEventListener("stderr", (event) => {
        const data = JSON.parse((event as MessageEvent).data);
        console.log("Auth stderr:", data.output);
      });

      eventSource.onerror = (error) => {
        console.error("EventSource error:", error);
        setAuthStatus({
          status: "error",
          message: "Connection to authentication server lost",
        });
        onError("Connection to authentication server lost");
      };
    } catch (error) {
      console.error("Authentication error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      setAuthStatus({ status: "error", message: errorMessage });
      onError(errorMessage);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // Could add a toast notification here
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const getStatusColor = () => {
    switch (authStatus.status) {
      case "starting":
        return "text-blue-600";
      case "waiting":
        return "text-orange-600";
      case "completed":
        return "text-green-600";
      case "error":
        return "text-red-600";
      default:
        return "text-gray-600";
    }
  };

  const getStatusIcon = () => {
    switch (authStatus.status) {
      case "starting":
        return "🔄";
      case "waiting":
        return "⏳";
      case "completed":
        return "✅";
      case "error":
        return "❌";
      default:
        return "ℹ️";
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="mx-4 max-w-md rounded-lg bg-white p-6 shadow-lg dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            GitHub Authentication
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className={`mb-4 flex items-center gap-2 ${getStatusColor()}`}>
          <span className="text-lg">{getStatusIcon()}</span>
          <span className="font-medium">
            {authStatus.status === "starting" && "Starting authentication..."}
            {authStatus.status === "waiting" && "Waiting for authentication..."}
            {authStatus.status === "completed" && "Authentication successful!"}
            {authStatus.status === "error" && "Authentication failed"}
          </span>
        </div>

        {authStatus.message && (
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            {authStatus.message}
          </p>
        )}

        {authStatus.status === "waiting" &&
          authStatus.code &&
          authStatus.url && (
            <div className="space-y-4">
              <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700">
                <h3 className="mb-2 font-medium text-gray-900 dark:text-white">
                  Step 1: Copy the one-time code
                </h3>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-gray-100 px-3 py-2 font-mono text-sm dark:bg-gray-600">
                    {authStatus.code}
                  </code>
                  <button
                    onClick={() => copyToClipboard(authStatus.code!)}
                    className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700">
                <h3 className="mb-2 font-medium text-gray-900 dark:text-white">
                  Step 2: Open GitHub login page
                </h3>
                <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
                  Click the link below to open GitHub in a new tab and paste the
                  code.
                </p>
                <a
                  href={authStatus.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                  Open GitHub
                </a>
              </div>

              <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
                <h3 className="mb-2 font-medium text-blue-900 dark:text-blue-100">
                  Step 3: Complete authentication
                </h3>
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  After you complete the authentication in GitHub, this dialog
                  will automatically close and your pull requests will load.
                </p>
              </div>
            </div>
          )}

        {authStatus.status === "error" && (
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded bg-gray-600 px-4 py-2 text-white hover:bg-gray-700"
            >
              Close
            </button>
            <button
              onClick={() => {
                setAuthStatus({ status: "starting" });
                startAuthentication();
              }}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
