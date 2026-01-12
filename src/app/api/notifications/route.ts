import { exec } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";

const execAsync = promisify(exec);

// Rate limiting and caching
const CACHE_TTL_MS = 60000; // 1 minute cache
const ERROR_BACKOFF_MS = 300000; // 5 minutes backoff after errors
const RATE_LIMIT_WINDOW_MS = 60000;
const MAX_GH_CALLS_PER_WINDOW = 20;
const MIN_SLEEP_MS = 100;
const SLEEP_STEP_MS = 250;
let cachedData: {
  notifications: PRNotification[];
  total: number;
  timestamp: number;
} | null = null;
let lastErrorTime = 0;
let isFetching = false;
const pendingRequests: Array<(value: NextResponse) => void> = [];
const ghCallTimestamps: number[] = [];
const ghMetrics = {
  total: 0,
  throttledCount: 0,
  throttledMs: 0,
  byType: {
    notifications: 0,
    prDetails: 0,
    graphql: 0,
    user: 0,
  },
};

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

function log(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data !== undefined) {
    console.log(`[${timestamp}] ${message}`, data);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

function logError(message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  if (error instanceof Error) {
    console.error(`[${timestamp}] ${message}:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  } else {
    console.error(`[${timestamp}] ${message}:`, error);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pruneGhCallWindow(now: number) {
  while (
    ghCallTimestamps.length &&
    now - ghCallTimestamps[0] >= RATE_LIMIT_WINDOW_MS
  ) {
    ghCallTimestamps.shift();
  }
}

async function waitForGhSlot() {
  let waited = 0;
  while (true) {
    const now = Date.now();
    pruneGhCallWindow(now);
    if (ghCallTimestamps.length < MAX_GH_CALLS_PER_WINDOW) {
      ghCallTimestamps.push(now);
      return waited;
    }
    const untilReset = RATE_LIMIT_WINDOW_MS - (now - ghCallTimestamps[0]);
    const sleepFor = Math.max(
      MIN_SLEEP_MS,
      Math.min(SLEEP_STEP_MS, untilReset)
    );
    await sleep(sleepFor);
    waited += sleepFor;
  }
}

function recordGhCall(
  type: keyof typeof ghMetrics.byType,
  throttledMs: number
) {
  ghMetrics.total += 1;
  ghMetrics.byType[type] += 1;
  if (throttledMs > 0) {
    ghMetrics.throttledCount += 1;
    ghMetrics.throttledMs += throttledMs;
  }
}

async function runGhCommand(
  type: keyof typeof ghMetrics.byType,
  command: string
): Promise<{ stdout: string; stderr: string }> {
  const throttledMs = await waitForGhSlot();
  const result = await execAsync(command);
  recordGhCall(type, throttledMs);
  return result;
}

function getGhMetricsSnapshot() {
  pruneGhCallWindow(Date.now());
  return {
    total: ghMetrics.total,
    throttledCount: ghMetrics.throttledCount,
    throttledMs: ghMetrics.throttledMs,
    byType: ghMetrics.byType,
    windowSizeMs: RATE_LIMIT_WINDOW_MS,
    windowLimit: MAX_GH_CALLS_PER_WINDOW,
    currentWindowCount: ghCallTimestamps.length,
  };
}

async function getNotificationPRs(): Promise<PRNotification[]> {
  log("Fetching notification PRs...");
  try {
    const { stdout, stderr } = await runGhCommand(
      "notifications",
      `gh api notifications --paginate -q '[.[] | select(.subject.type == "PullRequest")] | .[] | {title: .subject.title, reason: .reason, url: .subject.url}'`
    );

    if (stderr) {
      log("Notification PRs stderr:", stderr);
    }

    const lines = stdout.trim().split("\n").filter(Boolean);
    const notifications: PRNotification[] = [];

    for (const line of lines) {
      try {
        const notification = JSON.parse(line);
        // The notification.url is already an API URL, don't double-process
        const apiUrl = notification.url;

        // Get full PR data in one REST API call
        const { stdout: prData } = await runGhCommand(
          "prDetails",
          `gh api "${apiUrl}" --jq '{state: .state, html_url: .html_url, repository: .base.repo.full_name, number: .number, headRef: .head.ref, closedAt: .closed_at, merged: .merged}'`
        );

        const prInfo = JSON.parse(prData.trim());

        notifications.push({
          title: notification.title,
          reason: notification.reason,
          url: apiUrl,
          state: prInfo.state.toLowerCase(),
          html_url: prInfo.html_url,
          repository: prInfo.repository,
          number: prInfo.number,
          closedAt: prInfo.closedAt,
          headRef: prInfo.headRef,
          merged: prInfo.merged,
        });
      } catch (error) {
        logError("Failed to process notification line", error);
      }
    }

    log(`Fetched ${notifications.length} notification PRs`);
    return notifications;
  } catch (error) {
    logError("Failed to fetch notification PRs", error);
    return [];
  }
}

async function searchPRsGraphQL(
  query: string,
  reason: string
): Promise<PRNotification[]> {
  log(`Searching PRs with GraphQL: "${query}" (reason: ${reason})`);
  try {
    const graphqlQuery = `
      query {
        search(query: "${query} type:pr", type: ISSUE, first: 100) {
          nodes {
            __typename
            ... on PullRequest {
              title
              url
              state
              reviewDecision
              repository {
                nameWithOwner
              }
              number
              closedAt
              headRef {
                name
              }
              merged
            }
          }
        }
      }
    `;

    const { stdout, stderr } = await runGhCommand(
      "graphql",
      `gh api graphql -f query='${graphqlQuery}'`
    );

    if (stderr) {
      log(`GraphQL search stderr for "${query}":`, stderr);
    }

    const result = JSON.parse(stdout);
    const prs = result.data.search.nodes
      .filter(
        (node: { __typename?: string }) =>
          node && node.__typename === "PullRequest"
      )
      .map(
        (pr: {
          title?: string;
          url?: string;
          state?: string;
          reviewDecision?:
            | "APPROVED"
            | "CHANGES_REQUESTED"
            | "REVIEW_REQUIRED"
            | null;
          repository?: { nameWithOwner?: string };
          number?: number;
          closedAt?: string | null;
          headRef?: { name?: string } | null;
          merged?: boolean;
        }) => ({
          title: pr.title || "Unknown",
          reason,
          url: (pr.url || "")
            .replace("github.com", "api.github.com/repos")
            .replace("/pull/", "/pulls/"),
          state: (pr.state || "unknown").toLowerCase(),
          html_url: pr.url || "",
          repository: pr.repository?.nameWithOwner || "unknown/unknown",
          number: pr.number || 0,
          closedAt: pr.closedAt ?? undefined,
          headRef: pr.headRef?.name || "unknown",
          merged: pr.merged || false,
          reviewDecision:
            pr.reviewDecision === "APPROVED" ||
            pr.reviewDecision === "CHANGES_REQUESTED" ||
            pr.reviewDecision === "REVIEW_REQUIRED"
              ? pr.reviewDecision
              : undefined,
        })
      )
      .filter(
        (pr: { url: string; repository: string }) =>
          pr.url && pr.repository !== "unknown/unknown"
      );

    log(`GraphQL search "${query}" returned ${prs.length} PRs`);
    return prs;
  } catch (error) {
    logError(`GraphQL search failed for "${query}"`, error);
    return [];
  }
}

async function getUsername(): Promise<string> {
  log("Fetching GitHub username...");
  const { stdout } = await runGhCommand("user", `gh api user --jq '.login'`);
  const username = stdout.trim();
  log(`GitHub username: ${username}`);
  return username;
}

export async function GET() {
  log("=== Starting PR fetch ===");

  // Check if we have fresh cached data
  if (cachedData && Date.now() - cachedData.timestamp < CACHE_TTL_MS) {
    const cacheAge = Math.floor((Date.now() - cachedData.timestamp) / 1000);
    log(`=== Serving cached data (${cacheAge}s old) ===`);
    return NextResponse.json({
      notifications: cachedData.notifications,
      total: cachedData.total,
      cached: true,
      ghMetrics: getGhMetricsSnapshot(),
    });
  }

  // Check if we're in error backoff period
  if (lastErrorTime && Date.now() - lastErrorTime < ERROR_BACKOFF_MS) {
    const backoffRemaining = Math.floor(
      (ERROR_BACKOFF_MS - (Date.now() - lastErrorTime)) / 1000
    );
    log(`=== Error backoff active: ${backoffRemaining}s remaining ===`);
    return NextResponse.json(
      {
        error: "Rate limit exceeded. Please try again later.",
        details: `Backing off for ${backoffRemaining} seconds to avoid further rate limiting.`,
        backoff: true,
      },
      { status: 429 }
    );
  }

  // If we're already fetching, wait for the existing request to complete
  if (isFetching) {
    log("=== Request deduplication: waiting for existing fetch ===");
    return new Promise<NextResponse>((resolve) => {
      pendingRequests.push(resolve);
    });
  }

  // Mark as fetching and start the process
  isFetching = true;
  const startTime = Date.now();

  try {
    const username = await getUsername();

    const [
      notificationPRs,
      authoredPRs,
      reviewRequestedPRs,
      reviewedPRs,
      commentedPRs,
    ] = await Promise.all([
      getNotificationPRs(),
      searchPRsGraphQL(`author:${username}`, "author"),
      searchPRsGraphQL(`review-requested:${username}`, "review_requested"),
      searchPRsGraphQL(`reviewed-by:${username}`, "reviewed"),
      searchPRsGraphQL(`commenter:${username}`, "commenter"),
    ]);

    log("Search results summary:", {
      notifications: notificationPRs.length,
      authored: authoredPRs.length,
      reviewRequested: reviewRequestedPRs.length,
      reviewed: reviewedPRs.length,
      commented: commentedPRs.length,
    });
    const allPRs = new Map<string, PRNotification>();

    for (const pr of notificationPRs) {
      allPRs.set(pr.url, pr);
    }

    for (const pr of [
      ...authoredPRs,
      ...reviewRequestedPRs,
      ...reviewedPRs,
      ...commentedPRs,
    ]) {
      allPRs.set(pr.url, pr);
    }

    const notifications = Array.from(allPRs.values());

    log(`Processing ${notifications.length} total PRs...`);

    // No enrichment needed - GraphQL already provides all required data
    const openCount = notifications.filter((n) => n.state === "open").length;
    const closedCount = notifications.filter(
      (n) => n.state === "closed" || n.state === "merged"
    ).length;

    const duration = Date.now() - startTime;
    log(`=== Completed in ${duration}ms ===`, {
      total: notifications.length,
      open: openCount,
      closed: closedCount,
    });

    // Update cache
    cachedData = {
      notifications,
      total: notifications.length,
      timestamp: Date.now(),
    };

    const response = NextResponse.json({
      notifications,
      total: notifications.length,
      ghMetrics: getGhMetricsSnapshot(),
    });

    // Resolve all pending requests with the same response
    pendingRequests.forEach((resolve) => resolve(response));
    pendingRequests.length = 0;

    return response;
  } catch (error) {
    logError("Fatal error fetching notifications", error);

    // Check if it's a rate limit error
    const isRateLimitError =
      error instanceof Error &&
      (error.message.includes("rate limit exceeded") ||
        error.message.includes("HTTP 403"));

    // Only set backoff time for rate limit errors, not auth errors
    if (isRateLimitError) {
      lastErrorTime = Date.now();
    }

    const errorResponse = NextResponse.json(
      {
        error: isRateLimitError
          ? "Rate limit exceeded"
          : "Failed to fetch notifications",
        details: error instanceof Error ? error.message : "Unknown error",
        backoff: isRateLimitError,
        ghMetrics: getGhMetricsSnapshot(),
      },
      { status: isRateLimitError ? 429 : 500 }
    );

    // Resolve all pending requests with the error
    pendingRequests.forEach((resolve) => resolve(errorResponse));
    pendingRequests.length = 0;

    return errorResponse;
  } finally {
    isFetching = false;
  }
}
