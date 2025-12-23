import { NextRequest, NextResponse } from "next/server";

type CircleCIStatus = "success" | "failed" | "running" | "on_hold" | "unknown";

type CircleCIStatusResponse = {
  status: CircleCIStatus;
  pipelineUrl: string;
  cached?: boolean;
  error?: string;
};

const CACHE_TTL_MS = 30000;

const cache = new Map<
  string,
  { timestamp: number; data: CircleCIStatusResponse }
>();

function getToken() {
  return process.env.CIRCLECI_TOKEN ?? process.env.CIRCLE_TOKEN;
}

function getPipelineUrl(repo: string, branch: string) {
  const searchParams = new URLSearchParams({ branch });
  return `https://app.circleci.com/pipelines/github/${repo}?${searchParams.toString()}`;
}

type CircleCIWorkflow = {
  status?:
    | "success"
    | "running"
    | "not_run"
    | "failed"
    | "error"
    | "failing"
    | "on_hold"
    | "canceled"
    | "unauthorized";
};

function summarizeStatus(workflows: CircleCIWorkflow[]): CircleCIStatus {
  if (workflows.length === 0) {
    return "unknown";
  }

  const statuses = workflows.map((w) => w.status).filter(Boolean);

  if (
    statuses.some(
      (s) =>
        s === "failed" ||
        s === "error" ||
        s === "canceled" ||
        s === "unauthorized" ||
        s === "not_run"
    )
  ) {
    return "failed";
  }

  if (statuses.some((s) => s === "on_hold")) {
    return "on_hold";
  }

  if (statuses.some((s) => s === "running" || s === "failing")) {
    return "running";
  }

  if (statuses.length > 0 && statuses.every((s) => s === "success")) {
    return "success";
  }

  return "unknown";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const repo = searchParams.get("repo");
  const branch = searchParams.get("branch");

  if (!repo || !branch) {
    return NextResponse.json(
      {
        status: "unknown",
        pipelineUrl: "",
        error: "repo and branch are required",
      },
      { status: 400 }
    );
  }

  const pipelineUrl = getPipelineUrl(repo, branch);

  const cacheKey = `${repo}#${branch}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.data, cached: true });
  }

  const token = getToken();
  if (!token) {
    const data: CircleCIStatusResponse = {
      status: "unknown",
      pipelineUrl,
      error: "CircleCI token not configured (set CIRCLECI_TOKEN)",
    };
    cache.set(cacheKey, { timestamp: Date.now(), data });
    return NextResponse.json(data, { status: 401 });
  }

  const [org, project] = repo.split("/");
  if (!org || !project) {
    return NextResponse.json(
      { status: "unknown", pipelineUrl, error: "Invalid repo format" },
      { status: 400 }
    );
  }

  try {
    const pipelinesRes = await fetch(
      `https://circleci.com/api/v2/project/gh/${org}/${project}/pipeline?branch=${encodeURIComponent(
        branch
      )}`,
      {
        headers: {
          "Circle-Token": token,
          Accept: "application/json",
        },
      }
    );

    if (!pipelinesRes.ok) {
      const data: CircleCIStatusResponse = {
        status: "unknown",
        pipelineUrl,
        error: `CircleCI pipelines API error (${pipelinesRes.status})`,
      };
      cache.set(cacheKey, { timestamp: Date.now(), data });
      return NextResponse.json(data, { status: 502 });
    }

    const pipelinesJson = (await pipelinesRes.json()) as {
      items?: Array<{ id?: string; state?: string }>;
    };

    const latestPipeline = pipelinesJson.items?.[0];
    const pipelineId = latestPipeline?.id;

    if (!pipelineId) {
      const data: CircleCIStatusResponse = {
        status: "unknown",
        pipelineUrl,
      };
      cache.set(cacheKey, { timestamp: Date.now(), data });
      return NextResponse.json(data);
    }

    const workflowsRes = await fetch(
      `https://circleci.com/api/v2/pipeline/${pipelineId}/workflow`,
      {
        headers: {
          "Circle-Token": token,
          Accept: "application/json",
        },
      }
    );

    if (!workflowsRes.ok) {
      const data: CircleCIStatusResponse = {
        status: "unknown",
        pipelineUrl,
        error: `CircleCI workflows API error (${workflowsRes.status})`,
      };
      cache.set(cacheKey, { timestamp: Date.now(), data });
      return NextResponse.json(data, { status: 502 });
    }

    const workflowsJson = (await workflowsRes.json()) as {
      items?: CircleCIWorkflow[];
    };
    const workflows = workflowsJson.items ?? [];

    const status = summarizeStatus(workflows);
    const data: CircleCIStatusResponse = {
      status,
      pipelineUrl,
    };
    cache.set(cacheKey, { timestamp: Date.now(), data });
    return NextResponse.json(data);
  } catch (error) {
    const data: CircleCIStatusResponse = {
      status: "unknown",
      pipelineUrl,
      error: error instanceof Error ? error.message : "Unknown error",
    };
    cache.set(cacheKey, { timestamp: Date.now(), data });
    return NextResponse.json(data, { status: 500 });
  }
}
