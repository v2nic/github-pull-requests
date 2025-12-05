import { NextResponse } from "next/server";
import { spawn } from "child_process";

export async function GET(): Promise<NextResponse> {
  try {
    // Check if GitHub CLI is available

    return new Promise<NextResponse>((resolve) => {
      const ghProcess = spawn("gh", ["--version"], {
        stdio: "pipe",
        timeout: 5000,
      });

      let stdout = "";
      let stderr = "";

      ghProcess.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      ghProcess.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      ghProcess.on("close", (code: number) => {
        if (code === 0) {
          resolve(
            NextResponse.json({
              status: "healthy",
              timestamp: new Date().toISOString(),
              github_cli: {
                installed: true,
                version: stdout.trim(),
                authenticated: false, // We could check auth status here if needed
              },
            })
          );
        } else {
          resolve(
            NextResponse.json(
              {
                status: "unhealthy",
                timestamp: new Date().toISOString(),
                error: "GitHub CLI not available",
                stderr: stderr.trim(),
              },
              { status: 503 }
            )
          );
        }
      });

      ghProcess.on("error", (error: Error) => {
        resolve(
          NextResponse.json(
            {
              status: "unhealthy",
              timestamp: new Date().toISOString(),
              error: error.message,
            },
            { status: 503 }
          )
        );
      });
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
