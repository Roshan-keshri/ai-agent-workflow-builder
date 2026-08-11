import type { Request, Response } from "express";

type Json = Record<string, any>;

// Dynamic Nhost fallback for GraphQL endpoint & Admin Secret
const HASURA_GRAPHQL_URL =
  process.env.NHOST_GRAPHQL_URL ||
  (process.env.NHOST_SUBDOMAIN && process.env.NHOST_REGION
    ? `https://${process.env.NHOST_SUBDOMAIN}.hasura.${process.env.NHOST_REGION}.nhost.run/v1/graphql`
    : undefined);

const HASURA_ADMIN_SECRET =
  process.env.NHOST_ADMIN_SECRET || process.env.HASURA_GRAPHQL_ADMIN_SECRET;

// ---------- helpers ----------

async function gql<T = any>(query: string, variables?: Json): Promise<T> {
  if (!HASURA_GRAPHQL_URL || !HASURA_ADMIN_SECRET) {
    throw new Error(
      `Missing GraphQL config: URL=${!!HASURA_GRAPHQL_URL}, SECRET=${!!HASURA_ADMIN_SECRET}`
    );
  }

  const response = await fetch(HASURA_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": HASURA_ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await response.text();
  let json: any;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Hasura returned non-JSON response: ${text}`);
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

// ---------- GraphQL ----------

const GET_WORKFLOW = `
query GetWorkflow($workflow_id: uuid!) {
  workflows_by_pk(id: $workflow_id) {
    id
    org_id
    name
    organization: organization {
      id
      quota_used
      quota_allowed
    }
  }
}
`;

const GET_MEMBERSHIP = `
query GetMembership($org_id: uuid!, $user_id: uuid!) {
  org_members(
    where: { org_id: { _eq: $org_id }, user_id: { _eq: $user_id } }
    limit: 1
  ) {
    id
    role
    org_id
    user_id
  }
}
`;

const INSERT_WORKFLOW_RUN = `
mutation InsertWorkflowRun(
  $workflow_id: uuid!
  $org_id: uuid!
  $started_by: uuid!
  $trigger_type: trigger_type!
  $input: jsonb!
) {
  insert_workflow_runs_one(
    object: {
      workflow_id: $workflow_id
      org_id: $org_id
      status: "running"
      trigger_type: $trigger_type
      input: $input
    }
  ) {
    id
    status
    workflow_id
    org_id
  }
}
`;

const GET_WORKFLOW_STEPS = `
query GetWorkflowSteps($workflow_id: uuid!) {
  workflow_steps(
    where: { workflow_id: { _eq: $workflow_id } }
    order_by: { step_order: asc }
  ) {
    id
    step_order
    type
    name
    config
  }
}
`;

const INSERT_STEP_RUNS = `
mutation InsertStepRuns($objects: [step_runs_insert_input!]!) {
  insert_step_runs(objects: $objects) {
    affected_rows
  }
}
`;

// ---------- handler ----------

export default async function handler(req: Request, res: Response) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).send();
  }

  if (req.method !== "POST") {
    return sendResponse(res, 405, { ok: false, message: "Method not allowed" });
  }

  try {
    const payload = req.body ?? {};
    const actionInput = payload?.input ?? payload;

    const workflow_id = actionInput?.workflow_id as string | undefined;
    const trigger_type = (actionInput?.trigger_type || "manual") as
      | "manual"
      | "webhook"
      | "scheduled"
      | "db_event";
    const input = (actionInput?.input || {}) as Json;

    if (!workflow_id) {
      return sendResponse(res, 400, {
        ok: false,
        message: "workflow_id is required",
      });
    }

    const headerUserId = req.headers["x-hasura-user-id"];
    const normalizedHeaderUserId = Array.isArray(headerUserId)
      ? headerUserId[0]
      : headerUserId;

    const sessionUserId =
      payload?.session_variables?.["x-hasura-user-id"] ||
      payload?.session_variables?.["X-Hasura-User-Id"];

    const authenticatedUserId = normalizedHeaderUserId || sessionUserId;

    if (!authenticatedUserId) {
      return sendResponse(res, 401, {
        ok: false,
        message: "Missing x-hasura-user-id",
      });
    }

    console.log("triggerWorkflowRun invoked", {
      workflow_id,
      userId: authenticatedUserId,
      hasActionWrapper: !!payload?.action,
    });

    const workflowData = await gql<{
      workflows_by_pk: {
        id: string;
        org_id: string;
        name: string;
        organization: { id: string; quota_used: number; quota_allowed: number };
      } | null;
    }>(GET_WORKFLOW, { workflow_id });

    const workflow = workflowData.workflows_by_pk;
    if (!workflow) {
      return sendResponse(res, 404, { ok: false, message: "Workflow not found" });
    }

    const membershipData = await gql<{
      org_members: Array<{
        id: string;
        role: "owner" | "editor" | "viewer";
        org_id: string;
        user_id: string;
      }>;
    }>(GET_MEMBERSHIP, {
      org_id: workflow.org_id,
      user_id: authenticatedUserId,
    });

    const membership = membershipData.org_members?.[0];
    if (!membership) {
      return sendResponse(res, 403, {
        ok: false,
        message: "Access denied: user is not a member of this organization",
      });
    }

    if (!["owner", "editor"].includes(membership.role)) {
      return sendResponse(res, 403, {
        ok: false,
        message: "Access denied: only owner/editor can trigger workflows",
      });
    }

    if (
      workflow.organization &&
      workflow.organization.quota_used >= workflow.organization.quota_allowed
    ) {
      return sendResponse(res, 403, {
        ok: false,
        message: "Quota exceeded for this organization",
      });
    }

    const runData = await gql<{
      insert_workflow_runs_one: {
        id: string;
        status: string;
        workflow_id: string;
        org_id: string;
      };
    }>(INSERT_WORKFLOW_RUN, {
      workflow_id: workflow.id,
      org_id: workflow.org_id,
      started_by: authenticatedUserId,
      trigger_type,
      input,
    });

    const workflow_run_id = runData.insert_workflow_runs_one.id;

    const stepsData = await gql<{
      workflow_steps: Array<{
        id: string;
        step_order: number;
        type: string;
        name: string;
        config: Json;
      }>;
    }>(GET_WORKFLOW_STEPS, { workflow_id: workflow.id });

    const steps = stepsData.workflow_steps || [];
    const stepObjects = steps.map((step) => ({
      workflow_run_id,
      workflow_step_id: step.id,
      status: "pending",
      input: {},
      attempt_count: 0,
    }));

    if (stepObjects.length > 0) {
      await gql(INSERT_STEP_RUNS, { objects: stepObjects });
    }

    return sendResponse(res, 200, {
      ok: true,
      message: "Workflow run created successfully",
      workflow_run_id,
      step_count: stepObjects.length,
    });
  } catch (error: any) {
    console.error("triggerWorkflowRun error:", error);
    return sendResponse(res, 500, {
      ok: false,
      message: "Internal error in triggerWorkflowRun",
      error: error?.message || String(error),
    });
  }
}