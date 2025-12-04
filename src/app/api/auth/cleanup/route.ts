import { NextRequest, NextResponse } from "next/server";
import { authProcesses } from "../login/route";

export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    if (!sessionId) {
      return NextResponse.json(
        { error: "Session ID required" },
        { status: 400 }
      );
    }

    const authProcess = authProcesses.get(sessionId);

    if (authProcess && authProcess.process) {
      try {
        // Kill the process
        authProcess.process.kill("SIGTERM");

        // Wait a bit for graceful shutdown
        setTimeout(() => {
          if (authProcess.process && !authProcess.process.killed) {
            authProcess.process.kill("SIGKILL");
          }
        }, 5000);

        // Remove from map
        authProcesses.delete(sessionId);

        return NextResponse.json({
          message: "Process cleaned up successfully",
        });
      } catch (killError) {
        console.error("Failed to kill process:", killError);
        return NextResponse.json(
          { error: "Failed to kill process" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ message: "No process found for session" });
  } catch (error) {
    console.error("Cleanup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // Clean up all orphaned processes older than 15 minutes
    const now = Date.now();
    const cleanedSessions: string[] = [];

    for (const [sessionId, authProcess] of authProcesses.entries()) {
      // If process is older than 15 minutes and not completed, clean it up
      if (!authProcess.completed && authProcess.startTime) {
        const age = now - authProcess.startTime;
        if (age > 15 * 60 * 1000) {
          // 15 minutes
          try {
            authProcess.process.kill("SIGKILL");
            cleanedSessions.push(sessionId);
          } catch (error) {
            console.error(
              `Failed to kill orphaned process ${sessionId}:`,
              error
            );
          }
        }
      }
    }

    // Remove cleaned sessions from map
    cleanedSessions.forEach((sessionId) => {
      authProcesses.delete(sessionId);
    });

    return NextResponse.json({
      message: `Cleaned up ${cleanedSessions.length} orphaned processes`,
      cleanedSessions,
    });
  } catch (error) {
    console.error("Batch cleanup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
