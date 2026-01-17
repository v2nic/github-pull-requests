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
  // Use the same path for both container and host since volume is mounted at same location
  return process.env.SOURCE_BASE_PATH || "/Users/nicolas/Source";
}

function getRepoPath(repoFullName: string) {
  const repoName = repoFullName.split("/")[1]; // owner/repo -> repo
  return path.join(getSourceDir(), repoName);
}

// Logic from wta bash function
async function getWorktreePath(
  repoPath: string,
  branch: string,
): Promise<{ worktreePath: string; gitCmd: string[] }> {
  // Check if repoPath exists
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repository not found at ${repoPath}`);
  }

  // Get git_dir
  const { stdout: gitDirOut } = await execAsync("git rev-parse --git-dir", {
    cwd: repoPath,
  });
  const gitDir = gitDirOut.trim();

  // Get repo_root (toplevel)
  let repoRoot = "";
  try {
    const { stdout: repoRootOut } = await execAsync(
      "git rev-parse --show-toplevel",
      { cwd: repoPath },
    );
    repoRoot = repoRootOut.trim();
  } catch {
    // Ignore error, empty repoRoot means bare repo or something similar (handled below)
  }

  // Resolve repoDir
  const resolvedGitDir = path.resolve(repoPath, gitDir);
  let repoDir = resolvedGitDir;
  if (path.basename(repoDir) === ".git") {
    repoDir = path.dirname(repoDir);
  }

  // Worktree path is always repoDir/branch
  const worktreePath = path.join(repoDir, branch);

  // Git command
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
    // If main repo doesn't exist, we can't do anything
    if (!fs.existsSync(repoPath)) {
      return NextResponse.json({
        exists: false,
        error: "Repository not found locally",
      });
    }

    const { worktreePath, gitCmd } = await getWorktreePath(repoPath, branch);
    const existingWorktreePath = await findExistingWorktreePath(
      repoPath,
      branch,
      gitCmd,
    );

    // Check if worktree exists
    const exists = Boolean(existingWorktreePath) || fs.existsSync(worktreePath);

    return NextResponse.json({
      exists,
      path: existingWorktreePath ?? worktreePath, // Same path for both operations and display
    });
  } catch (error) {
    console.error("Error checking worktree:", error);
    return NextResponse.json({ exists: false, error: String(error) });
  }
}

export async function POST(request: Request) {
  try {
    const { repo, branch } = await request.json();

    if (!repo || !branch) {
      return NextResponse.json(
        { error: "Missing repo or branch" },
        { status: 400 },
      );
    }

    const repoPath = getRepoPath(repo);
    const { worktreePath, gitCmd } = await getWorktreePath(repoPath, branch);
    const existingWorktreePath = await findExistingWorktreePath(
      repoPath,
      branch,
      gitCmd,
    );

    if (existingWorktreePath || fs.existsSync(worktreePath)) {
      return NextResponse.json({
        success: true,
        path: existingWorktreePath ?? worktreePath, // Same path for both operations and display
        message: "Worktree already exists",
      });
    }

    // Construct the command
    // Decide where the branch should come from
    // if "${git_cmd[@]}" show-ref --verify --quiet "refs/heads/$branch"; then
    //     "${git_cmd[@]}" worktree add "$worktree_path" "$branch"
    // elif "${git_cmd[@]}" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    //     "${git_cmd[@]}" worktree add --track -b "$branch" "$worktree_path" "origin/$branch"
    // else
    //     "${git_cmd[@]}" worktree add --track -b "$branch" "$worktree_path" "origin/main"
    // fi

    const baseGitCmd = gitCmd.join(" ");

    // Helper to run git command
    const runGit = async (cmd: string) => {
      return execAsync(`${baseGitCmd} ${cmd}`, { cwd: repoPath });
    };

    const hasLocalBranch = await runGit(
      `show-ref --verify --quiet "refs/heads/${branch}"`,
    )
      .then(() => true)
      .catch(() => false);

    const hasRemoteBranch = await runGit(
      `show-ref --verify --quiet "refs/remotes/origin/${branch}"`,
    )
      .then(() => true)
      .catch(() => false);

    let command = "";
    if (hasLocalBranch) {
      command = `worktree add "${worktreePath}" "${branch}"`;
    } else if (hasRemoteBranch) {
      command = `worktree add --track -b "${branch}" "${worktreePath}" "origin/${branch}"`;
    } else {
      command = `worktree add --track -b "${branch}" "${worktreePath}" "origin/main"`;
    }

    await runGit(command);

    return NextResponse.json({ success: true, path: worktreePath });
  } catch (error) {
    console.error("Error creating worktree:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
