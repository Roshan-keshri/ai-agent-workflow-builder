import type { Request, Response } from "express";

type Json = Record<string, any>;

const GRAPHQL_URL =
  process.env.NHOST_GRAPHQL_URL ||
  (process.env.NHOST_SUBDOMAIN && process.env.NHOST_REGION
    ? `https://${process.env.NHOST_SUBDOMAIN}.hasura.${process.env.NHOST_REGION}.nhost.run/v1/graphql`
    : undefined);

const ADMIN_SECRET =
  process.env.NHOST_ADMIN_SECRET || process.env.HASURA_GRAPHQL_ADMIN_SECRET;

async function gql<T = any>(query: string, variables?: Json): Promise<T> {
  if (!GRAPHQL_URL || !ADMIN_SECRET) {
    throw new Error(`Missing GraphQL config: URL=${!!GRAPHQL_URL}, SECRET=${!!ADMIN_SECRET}`);
  }

  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await response.text();
  let json: any;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Hasura returned non-JSON: ${text}`);
  }

  if (!response.ok || json.errors) {
    throw new Error(JSON.stringify(json.errors || json));
  }

  return json.data;
}

function setCors(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, authorization, x-hasura-user-id, x-hasura-role"
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function sendResponse(res: Response, status: number, body: Json) {
  setCors(res);
  return res.status(status).json(body);
}

const GET_STEP_RUN = `
query GetStepRun($step_run_id: uuid!) {
  step_runs_by_pk(id: $step_run_id) {
    id
    status
    workflow_run_id
    workflow_step_id
    workflow_run {
      id
      org_id
      started_by
    }
  }
}
`;

const APPROVE_STEP = `
mutation ApproveStep($step_run_id: uuid!, $approved_by: uuid!, $status: step_run_status!) {
  update_step_runs_by_pk(
    pk_columns: { id: $step_run_id }
    _set: {
      status: $status
      approved_by: $approved_by
      approved_at: "now()"
    }
  ) {
    id
    status
    workflow_run_id
  }
}
`;

const UPDATE_WORKFLOW_RUN_STATUS = `
mutation UpdateWorkflowRunStatus($workflow_run_id: uuid!, $status: run_status!) {
  update_workflow_runs_by_pk(
    pk_columns: { id: $workflow_run_id }
    _set: { status: $status }
  ) {
    id
    status
  }
}
`;

export default async function handler(req: Request, res: Response) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).send();
  }

  if (req.method !== "POST") {
    return sendResponse(res, 405, { ok: false, message: "Method not allowed" });
  }

  try {
    const rawBody = req.body ?? {};
    const actionInput = rawBody?.input ?? rawBody;

    const step_run_id = actionInput?.step_run_id as string | undefined;
    const decision = (actionInput?.decision || "approved") as "approved" | "rejected";

    if (!step_run_id) {
      return sendResponse(res, 400, { ok: false, message: "step_run_id is required" });
    }

    const headerUserId = req.headers["x-hasura-user-id"];
    const normalizedHeaderUserId = Array.isArray(headerUserId) ? headerUserId[0] : headerUserId;
    const sessionUserId =
      rawBody?.session_variables?.["x-hasura-user-id"] ||
      rawBody?.session_variables?.["X-Hasura-User-Id"];

    const userId = normalizedHeaderUserId || sessionUserId;

    if (!userId) {
      return sendResponse(res, 401, { ok: false, message: "Missing x-hasura-user-id header" });
    }

    const stepData = await gql<{
      step_runs_by_pk: {
        id: string;
        status: string;
        workflow_run_id: string;
        workflow_step_id: string;
        workflow_run: {
          id: string;
          org_id: string;
          started_by: string;
        };
      } | null;
    }>(GET_STEP_RUN, { step_run_id });

    const stepRun = stepData.step_runs_by_pk;

    if (!stepRun) {
      return sendResponse(res, 404, { ok: false, message: "Step run not found" });
    }

    const membershipData = await gql<{
      org_members: Array<{
        id: string;
        role: string;
        org_id: string;
      }>;
    }>(
      `
      query CheckMembership($org_id: uuid!, $user_id: uuid!) {
        org_members(where: { org_id: { _eq: $org_id }, user_id: { _eq: $user_id } }, limit: 1) {
          id
          role
          org_id
        }
      }
      `,
      { org_id: stepRun.workflow_run.org_id, user_id: userId }
    );

    const membership = membershipData.org_members?.[0];

    if (!membership) {
      return sendResponse(res, 403, { ok: false, message: "Access denied" });
    }

    if (!["owner", "editor"].includes(membership.role)) {
      return sendResponse(res, 403, { ok: false, message: "Only owner/editor can approve steps" });
    }

    if (stepRun.status !== "pending") {
      return sendResponse(res, 400, {
        ok: false,
        message: `Step cannot be approved because status is ${stepRun.status}`,
      });
    }

    const targetStepStatus = decision === "approved" ? "success" : "failed";
    const targetWorkflowStatus = decision === "approved" ? "success" : "failed";

    const result = await gql<{
      update_step_runs_by_pk: {
        id: string;
        status: string;
        workflow_run_id: string;
      };
    }>(APPROVE_STEP, {
      step_run_id,
      approved_by: userId,
      status: targetStepStatus,
    });

    await gql(UPDATE_WORKFLOW_RUN_STATUS, {
      workflow_run_id: stepRun.workflow_run_id,
      status: targetWorkflowStatus,
    });

    return sendResponse(res, 200, {
      ok: true,
      message: `Step ${decision} successfully`,
      step_run_id: result.update_step_runs_by_pk.id,
      status: result.update_step_runs_by_pk.status,
      workflow_run_id: result.update_step_runs_by_pk.workflow_run_id,
    });
  } catch (error: any) {
    console.error("approveStep error:", error);
    return sendResponse(res, 500, {
      ok: false,
      message: "Internal error in approveStep",
      error: error?.message || String(error),
    });
  }
}