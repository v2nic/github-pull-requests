import { NextResponse } from "next/server";
import { spawn } from "child_process";

export async function POST(): Promise<NextResponse> {
  try {
    return new Promise<NextResponse>((resolve) => {
      // Run gh auth logout to clear stored credentials
      const logoutProcess = spawn("gh", ["auth", "logout"], {
        stdio: "pipe",
        timeout: 10000,
      });

      let stderr = "";

      logoutProcess.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      logoutProcess.on("close", (code: number) => {
        if (code === 0) {
          resolve(
            NextResponse.json({
              success: true,
              message: "Successfully logged out of GitHub CLI",
            })
          );
        } else {
          resolve(
            NextResponse.json({
              success: false,
              message: "Logout completed with warnings",
              stderr: stderr.trim(),
            })
          );
        }
      });

      logoutProcess.on("error", (error: Error) => {
        resolve(
          NextResponse.json(
            {
              success: false,
              message: "Failed to logout",
              error: error.message,
            },
            { status: 500 }
          )
        );
      });
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
