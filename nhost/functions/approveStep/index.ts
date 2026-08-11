type Json = Record<string, any>;

const GRAPHQL_URL =
  process.env.NHOST_GRAPHQL_URL ||
  process.env.NHOST_HASURA_URL ||
  (process.env.NHOST_SUBDOMAIN && process.env.NHOST_REGION
    ? `https://${process.env.NHOST_SUBDOMAIN}.hasura.${process.env.NHOST_REGION}.nhost.run/v1/graphql`
    : undefined);

const ADMIN_SECRET =
  process.env.NHOST_ADMIN_SECRET || process.env.HASURA_GRAPHQL_ADMIN_SECRET;

function headers() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "content-type, authorization, x-hasura-user-id, x-hasura-role",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function response(status: number, body: Json) {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(),
  });
}

async function gql<T = any>(
  query: string,
  variables?: Json
): Promise<T> {
  if (!GRAPHQL_URL || !ADMIN_SECRET) {
    throw new Error("Missing Nhost GraphQL configuration");
  }

  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": ADMIN_SECRET,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  const data = await res.json();

  if (!res.ok || data.errors) {
    throw new Error(
      JSON.stringify(data.errors || data)
    );
  }

  return data.data;
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

export default async function handler(
  req: Request
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: headers(),
    });
  }

  if (req.method !== "POST") {
    return response(405, {
      ok: false,
      message: "Method not allowed",
    });
  }

  try {
    const rawBody = await req.json().catch(() => ({}));

    // Handle both direct JSON calls and Hasura Action wrapper payloads
    const payload = rawBody?.input ?? rawBody;
    const step_run_id = payload?.step_run_id as string | undefined;
    const decision = (payload?.decision || "approved") as "approved" | "rejected";

    if (!step_run_id) {
      return response(400, {
        ok: false,
        message: "step_run_id is required",
      });
    }

    // Extract user ID from header or Hasura Action session variables
    const headerUserId = req.headers.get("x-hasura-user-id");
    const sessionUserId =
      rawBody?.session_variables?.["x-hasura-user-id"] ||
      rawBody?.session_variables?.["X-Hasura-User-Id"];

    const userId = headerUserId || sessionUserId;

    if (!userId) {
      return response(401, {
        ok: false,
        message: "Missing x-hasura-user-id header",
      });
    }

    // 1. Get step run and workflow details
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
    }>(GET_STEP_RUN, {
      step_run_id,
    });

    const stepRun = stepData.step_runs_by_pk;

    if (!stepRun) {
      return response(404, {
        ok: false,
        message: "Step run not found",
      });
    }

    // 2. Verify organization membership
    const membershipData = await gql<{
      org_members: Array<{
        id: string;
        role: string;
        org_id: string;
      }>;
    }>(
      `
      query CheckMembership(
        $org_id: uuid!,
        $user_id: uuid!
      ) {
        org_members(
          where: {
            org_id: {_eq: $org_id}
            user_id: {_eq: $user_id}
          }
          limit: 1
        ) {
          id
          role
          org_id
        }
      }
      `,
      {
        org_id: stepRun.workflow_run.org_id,
        user_id: userId,
      }
    );

    const membership = membershipData.org_members?.[0];

    if (!membership) {
      return response(403, {
        ok: false,
        message: "Access denied",
      });
    }

    // 3. Verify owner/editor authorization
    if (!["owner", "editor"].includes(membership.role)) {
      return response(403, {
        ok: false,
        message: "Only owner/editor can approve steps",
      });
    }

    // 4. Verify step status
    if (stepRun.status !== "pending") {
      return response(400, {
        ok: false,
        message: `Step cannot be approved because its current status is ${stepRun.status}`,
      });
    }

    const targetStepStatus = decision === "approved" ? "success" : "failed";
    const targetWorkflowStatus = decision === "approved" ? "success" : "failed";

    // 5. Update step status and approval metadata
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

    // 6. Update parent workflow run status
    await gql(UPDATE_WORKFLOW_RUN_STATUS, {
      workflow_run_id: stepRun.workflow_run_id,
      status: targetWorkflowStatus,
    });

    return response(200, {
      ok: true,
      message: `Step ${decision} successfully`,
      step_run_id: result.update_step_runs_by_pk.id,
      status: result.update_step_runs_by_pk.status,
      workflow_run_id: result.update_step_runs_by_pk.workflow_run_id,
    });
  } catch (error: any) {
    console.error("approveStep error:", error);

    return response(500, {
      ok: false,
      message: "Internal error in approveStep",
      error: error?.message || String(error),
    });
  }
}