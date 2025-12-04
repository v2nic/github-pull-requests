import { NextRequest } from "next/server";
import { spawn } from "child_process";

interface AuthProcess {
  process: any;
  code?: string;
  url?: string;
  completed: boolean;
  error?: string;
  startTime: number;
}

// Store auth processes in memory (in production, use Redis or similar)
const authProcesses = new Map<string, AuthProcess>();

// Rate limiting: track IP addresses and their request counts
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX_REQUESTS = 3; // Max 3 auth attempts per 5 minutes per IP

// Export for cleanup route
export { authProcesses };

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const limit = rateLimitMap.get(ip);

  if (!limit || now > limit.resetTime) {
    // Reset or create new limit
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (limit.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  limit.count++;
  return true;
}

function getClientIP(request: NextRequest): string {
  // Try various headers for the real IP
  const forwarded = request.headers.get("x-forwarded-for");
  const realIP = request.headers.get("x-real-ip");
  const ip = forwarded?.split(",")[0] || realIP || "unknown";
  return ip;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  const action = searchParams.get("action");

  if (action === "start") {
    return startAuthSession(sessionId);
  }

  if (!sessionId) {
    return new Response("Session ID required", { status: 400 });
  }

  const authProcess = authProcesses.get(sessionId);

  if (!authProcess) {
    return new Response(JSON.stringify({ status: "not_found" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      status: authProcess.completed ? "completed" : "in_progress",
      code: authProcess.code,
      url: authProcess.url,
      error: authProcess.error,
    }),
    {
      headers: { "Content-Type": "application/json" },
    }
  );
}

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  if (!checkRateLimit(ip)) {
    return new Response("Rate limit exceeded", { status: 429 });
  }

  const { sessionId } = await request.json();

  if (!sessionId) {
    return new Response("Session ID required", { status: 400 });
  }

  // POST just validates the session and allows it to proceed
  // The actual auth process is started by GET with action=start
  return new Response(JSON.stringify({ success: true, sessionId }), {
    headers: { "Content-Type": "application/json" },
  });
}

function startAuthSession(sessionId: string | null) {
  if (!sessionId) {
    return new Response("Session ID required", { status: 400 });
  }

  // Check if process already exists for this session
  if (authProcesses.has(sessionId)) {
    return new Response("Authentication already in progress", { status: 409 });
  }

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      let controllerClosed = false;

      // Spawn the gh auth login process
      const ghProcess = spawn("gh", ["auth", "login", "--web"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      const authProcess: AuthProcess = {
        process: ghProcess,
        completed: false,
        startTime: Date.now(),
      };

      authProcesses.set(sessionId, authProcess);

      // Helper function to send SSE events safely
      const sendEvent = (type: string, data: any) => {
        if (controllerClosed) return;
        try {
          const eventText = `event: ${type}\n`;
          const dataText = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(new TextEncoder().encode(eventText));
          controller.enqueue(new TextEncoder().encode(dataText));
        } catch (e) {
          console.log("Failed to send event (controller may be closed):", e);
          controllerClosed = true;
        }
      };

      // Helper function to safely close controller
      const safeClose = () => {
        if (controllerClosed) return;
        controllerClosed = true;
        try {
          controller.close();
        } catch (e) {
          console.log("Controller already closed");
        }
      };

      // Helper function to cleanup
      const cleanup = () => {
        authProcesses.delete(sessionId);
        // Kill the process if still running
        try {
          ghProcess.kill();
        } catch (e) {
          // Process may already be dead
        }
        safeClose();
      };

      // Parse stdout for one-time code and URL
      ghProcess.stdout.on("data", (data: Buffer) => {
        const output = data.toString();
        console.log("GH stdout:", output);

        // Extract one-time code using regex
        const codeMatch = output.match(/!\s+One-time code\s+\(([A-Z0-9-]+)\)/);
        if (codeMatch && !authProcess.code) {
          authProcess.code = codeMatch[1];
          sendEvent("code", { code: codeMatch[1] });
        }

        // Extract URL using regex
        const urlMatch = output.match(
          /Open this URL to continue in your web browser:\s+(https:\/\/[^\s]+)/
        );
        if (urlMatch && !authProcess.url) {
          authProcess.url = urlMatch[1];
          sendEvent("url", { url: urlMatch[1] });
        }
      });

      // Handle stderr - gh auth login outputs to stderr, not stdout
      ghProcess.stderr.on("data", (data: Buffer) => {
        const output = data.toString();
        console.log("GH stderr:", output);
        sendEvent("stderr", { output });

        // Extract one-time code using regex (gh outputs to stderr)
        const codeMatch = output.match(
          /First copy your one-time code:\s+([A-Z0-9-]+)/
        );
        if (codeMatch && !authProcess.code) {
          authProcess.code = codeMatch[1];
          sendEvent("code", { code: codeMatch[1] });
        }

        // Extract URL using regex (gh outputs to stderr)
        const urlMatch = output.match(
          /Open this URL to continue in your web browser:\s+(https:\/\/[^\s]+)/
        );
        if (urlMatch && !authProcess.url) {
          authProcess.url = urlMatch[1];
          sendEvent("url", { url: urlMatch[1] });
        }
      });

      // Handle process completion
      ghProcess.on("close", (code: number) => {
        console.log("GH process closed with code:", code);

        if (code === 0) {
          authProcess.completed = true;
          sendEvent("success", {
            message: "Authentication completed successfully",
          });
        } else {
          authProcess.error = `Authentication failed with exit code ${code}`;
          sendEvent("error", {
            message: `Authentication failed with exit code ${code}`,
          });
        }

        // Clean up after a delay
        setTimeout(cleanup, 1000);
      });

      // Handle process errors
      ghProcess.on("error", (error: Error) => {
        console.error("GH process error:", error);
        authProcess.error = error.message;
        sendEvent("error", { message: error.message });
        setTimeout(cleanup, 1000);
      });

      // Set timeout for the entire process (10 minutes)
      const timeout = setTimeout(() => {
        if (!authProcess.completed) {
          ghProcess.kill();
          authProcess.error = "Authentication timed out";
          sendEvent("error", { message: "Authentication timed out" });

          setTimeout(cleanup, 1000);
        }
      }, 10 * 60 * 1000);

      // Clean up timeout when process completes
      ghProcess.on("close", () => {
        clearTimeout(timeout);
      });

      // Send initial event
      sendEvent("start", { message: "Authentication process started" });
    },

    cancel() {
      // Clean up process if client disconnects
      const authProcess = authProcesses.get(sessionId);
      if (authProcess && authProcess.process) {
        authProcess.process.kill();
      }
      authProcesses.delete(sessionId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
