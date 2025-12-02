import { exec } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";

const execAsync = promisify(exec);

interface PRNotification {
  title: string;
  reason: string;
  url: string;
  state?: string;
  html_url?: string;
  repository?: string;
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

async function getNotificationPRs(): Promise<PRNotification[]> {
  log("Fetching notification PRs...");
  try {
    const { stdout, stderr } = await execAsync(
      `gh api notifications --paginate -q '[.[] | select(.subject.type == "PullRequest")] | .[] | {title: .subject.title, reason: .reason, url: .subject.url}'`
    );

    if (stderr) {
      log("Notification PRs stderr:", stderr);
    }

    const lines = stdout.trim().split("\n").filter(Boolean);
    const notifications: PRNotification[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        notifications.push(parsed);
      } catch (parseError) {
        log("Failed to parse notification line:", { line, error: parseError });
        continue;
      }
    }

    log(`Fetched ${notifications.length} notification PRs`);
    return notifications;
  } catch (error) {
    logError("Failed to fetch notification PRs", error);
    return [];
  }
}

async function searchPRs(
  query: string,
  reason: string
): Promise<PRNotification[]> {
  log(`Searching PRs: "${query}" (reason: ${reason})`);
  try {
    const cmd = `gh search prs "${query}" --json title,url,state,repository --limit 100`;
    const { stdout, stderr } = await execAsync(cmd);

    if (stderr) {
      log(`Search stderr for "${query}":`, stderr);
    }

    const results = JSON.parse(stdout);
    const prs = results.map(
      (pr: {
        title: string;
        url: string;
        state: string;
        repository: { nameWithOwner: string };
      }) => ({
        title: pr.title,
        reason,
        url: pr.url
          .replace("github.com", "api.github.com/repos")
          .replace("/pull/", "/pulls/"),
        state: pr.state.toLowerCase(),
        html_url: pr.url,
        repository: pr.repository.nameWithOwner,
      })
    );

    log(`Search "${query}" returned ${prs.length} PRs`);
    return prs;
  } catch (error) {
    logError(`Failed to search PRs for "${query}"`, error);
    return [];
  }
}

async function enrichNotification(
  notification: PRNotification
): Promise<PRNotification> {
  if (notification.state && notification.html_url) {
    return notification;
  }

  try {
    const { stdout: prData } = await execAsync(
      `gh api "${notification.url}" --jq '{state: .state, html_url: .html_url, repository: .base.repo.full_name}'`
    );
    const prInfo = JSON.parse(prData.trim());
    return { ...notification, ...prInfo };
  } catch (error) {
    logError(`Failed to enrich notification: ${notification.title}`, error);
    return notification;
  }
}

async function getUsername(): Promise<string> {
  log("Fetching GitHub username...");
  const { stdout } = await execAsync(`gh api user --jq '.login'`);
  const username = stdout.trim();
  log(`GitHub username: ${username}`);
  return username;
}

export async function GET() {
  log("=== Starting PR fetch ===");
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
      searchPRs(`author:${username}`, "author"),
      searchPRs(`review-requested:${username}`, "review_requested"),
      searchPRs(`reviewed-by:${username}`, "reviewed"),
      searchPRs(`commenter:${username}`, "commenter"),
    ]);

    log("Search results summary:", {
      notifications: notificationPRs.length,
      authored: authoredPRs.length,
      reviewRequested: reviewRequestedPRs.length,
      reviewed: reviewedPRs.length,
      commented: commentedPRs.length,
    });

    log(
      `Enriching ${Math.min(notificationPRs.length, 100)} notification PRs...`
    );
    const enrichedNotifications = await Promise.all(
      notificationPRs.slice(0, 100).map(enrichNotification)
    );

    const allPRs = new Map<string, PRNotification>();

    for (const pr of enrichedNotifications) {
      if (pr.html_url) {
        allPRs.set(pr.html_url, pr);
      }
    }

    for (const pr of [
      ...authoredPRs,
      ...reviewRequestedPRs,
      ...reviewedPRs,
      ...commentedPRs,
    ]) {
      if (pr.html_url && !allPRs.has(pr.html_url)) {
        allPRs.set(pr.html_url, pr);
      }
    }

    const notifications = Array.from(allPRs.values());
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

    return NextResponse.json({
      notifications,
      total: notifications.length,
    });
  } catch (error) {
    logError("Fatal error fetching notifications", error);
    return NextResponse.json(
      {
        error: "Failed to fetch notifications",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
