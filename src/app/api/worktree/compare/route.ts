import { exec } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

const execAsync = promisify(exec);

type WorktreeEntry = {
  path: string;
  branch: string | null;
};

function getSourceDir() {
  return process.env.SOURCE_BASE_PATH || "/Users/nicolas/Source";
}

function getRepoPath(repoFullName: string) {
  const repoName = repoFullName.split("/")[1];
  return path.join(getSourceDir(), repoName);
}

async function getWorktreePath(
  repoPath: string,
  branch: string,
): Promise<{ worktreePath: string; gitCmd: string[] }> {
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repository not found at ${repoPath}`);
  }

  const { stdout: gitDirOut } = await execAsync("git rev-parse --git-dir", {
    cwd: repoPath,
  });
  const gitDir = gitDirOut.trim();

  let repoRoot = "";
  try {
    const { stdout: repoRootOut } = await execAsync(
      "git rev-parse --show-toplevel",
      { cwd: repoPath },
    );
    repoRoot = repoRootOut.trim();
  } catch {
    repoRoot = "";
  }

  const resolvedGitDir = path.resolve(repoPath, gitDir);
  let repoDir = resolvedGitDir;
  if (path.basename(repoDir) === ".git") {
    repoDir = path.dirname(repoDir);
  }

  const worktreePath = path.join(repoDir, branch);
  const gitCmd = repoRoot ? ["git"] : ["git", `--git-dir=${resolvedGitDir}`];

  return { worktreePath, gitCmd };
}

function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;

  const flush = () => {
    if (current?.path) {
      entries.push(current);
    }
    current = null;
  };

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }

    if (line.startsWith("worktree ")) {
      flush();
      current = { path: line.replace("worktree ", "").trim(), branch: null };
      continue;
    }

    if (line.startsWith("branch ")) {
      if (!current) {
        current = { path: "", branch: null };
      }
      current.branch = line.replace("branch ", "").trim();
    }
  }

  flush();

  return entries;
}

function normalizeBranchRef(ref: string | null): string | null {
  if (!ref) return null;
  if (ref.startsWith("refs/heads/")) {
    return ref.replace("refs/heads/", "");
  }
  if (ref.startsWith("refs/remotes/origin/")) {
    return ref.replace("refs/remotes/origin/", "");
  }
  return ref;
}

async function findExistingWorktreePath(
  repoPath: string,
  branch: string,
  gitCmd: string[],
): Promise<string | null> {
  try {
    const baseGitCmd = gitCmd.join(" ");
    const { stdout } = await execAsync(
      `${baseGitCmd} worktree list --porcelain`,
      { cwd: repoPath },
    );
    const entries = parseWorktreeList(stdout);
    for (const entry of entries) {
      const normalizedBranch = normalizeBranchRef(entry.branch);
      if (normalizedBranch === branch) {
        return entry.path;
      }
    }
  } catch (error) {
    console.error("Error reading worktree list:", error);
  }

  return null;
}

async function hasRemoteBranch(
  repoPath: string,
  gitCmd: string[],
  branch: string,
) {
  const baseGitCmd = gitCmd.join(" ");
  return execAsync(
    `${baseGitCmd} show-ref --verify --quiet "refs/remotes/origin/${branch}"`,
    { cwd: repoPath },
  )
    .then(() => true)
    .catch(() => false);
}

async function hasLocalBranch(
  repoPath: string,
  gitCmd: string[],
  branch: string,
) {
  const baseGitCmd = gitCmd.join(" ");
  return execAsync(
    `${baseGitCmd} show-ref --verify --quiet "refs/heads/${branch}"`,
    { cwd: repoPath },
  )
    .then(() => true)
    .catch(() => false);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const repo = searchParams.get("repo");
  const branch = searchParams.get("branch");

  if (!repo || !branch) {
    return NextResponse.json(
      { error: "Missing repo or branch" },
      { status: 400 },
    );
  }

  try {
    const repoPath = getRepoPath(repo);
    if (!fs.existsSync(repoPath)) {
      return NextResponse.json({
        exists: false,
        error: "Repository not found locally",
      });
    }

    const { gitCmd } = await getWorktreePath(repoPath, branch);
    const existingWorktreePath = await findExistingWorktreePath(
      repoPath,
      branch,
      gitCmd,
    );

    if (!existingWorktreePath) {
      return NextResponse.json({
        exists: false,
        error: "Worktree not found",
      });
    }

    const localExists = await hasLocalBranch(repoPath, gitCmd, branch);
    if (!localExists) {
      return NextResponse.json({
        exists: true,
        incoming: 0,
        outgoing: 0,
        error: "Local branch not found",
      });
    }

    const remoteExists = await hasRemoteBranch(repoPath, gitCmd, branch);
    if (!remoteExists) {
      return NextResponse.json({
        exists: true,
        incoming: 0,
        outgoing: 0,
        error: "Remote branch not found",
      });
    }

    const baseGitCmd = gitCmd.join(" ");
    const { stdout } = await execAsync(
      `${baseGitCmd} rev-list --left-right --count origin/${branch}...${branch}`,
      { cwd: repoPath },
    );
    const [incomingRaw, outgoingRaw] = stdout.trim().split(/\s+/);
    const incoming = Number.parseInt(incomingRaw ?? "0", 10) || 0;
    const outgoing = Number.parseInt(outgoingRaw ?? "0", 10) || 0;

    return NextResponse.json({
      exists: true,
      incoming,
      outgoing,
    });
  } catch (error) {
    console.error("Error comparing worktree:", error);
    return NextResponse.json({
      exists: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
