type Json = Record<string, any>;

const GRAPHQL_URL =
  process.env.NHOST_GRAPHQL_URL ||
  process.env.NHOST_HASURA_URL;

const ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET;

function headers() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "content-type, authorization, x-hasura-user-id",
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
mutation ApproveStep($step_run_id: uuid!) {
  update_step_runs_by_pk(
    pk_columns: { id: $step_run_id }
    _set: {
      status: approved
    }
  ) {
    id
    status
    workflow_run_id
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
    const body = await req.json().catch(() => ({}));

    const step_run_id =
      body?.step_run_id as string | undefined;

    if (!step_run_id) {
      return response(400, {
        ok: false,
        message: "step_run_id is required",
      });
    }

    const userId =
      req.headers.get("x-hasura-user-id");

    if (!userId) {
      return response(401, {
        ok: false,
        message: "Missing x-hasura-user-id header",
      });
    }

    // 1. Get the step run and its workflow
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

    // 2. Check that the user belongs to the organization
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

    const membership =
      membershipData.org_members?.[0];

    if (!membership) {
      return response(403, {
        ok: false,
        message: "Access denied",
      });
    }

    // 3. Only owner/editor can approve
    if (
      !["owner", "editor"].includes(
        membership.role
      )
    ) {
      return response(403, {
        ok: false,
        message:
          "Only owner/editor can approve steps",
      });
    }

    // 4. Only pending steps can be approved
    if (stepRun.status !== "pending") {
      return response(400, {
        ok: false,
        message:
          `Step cannot be approved because its current status is ${stepRun.status}`,
      });
    }

    // 5. Approve the step
    const result = await gql<{
      update_step_runs_by_pk: {
        id: string;
        status: string;
        workflow_run_id: string;
      };
    }>(APPROVE_STEP, {
      step_run_id,
    });

    return response(200, {
      ok: true,
      message: "Step approved successfully",
      step_run_id:
        result.update_step_runs_by_pk.id,
      status:
        result.update_step_runs_by_pk.status,
      workflow_run_id:
        result.update_step_runs_by_pk.workflow_run_id,
    });
  } catch (error: any) {
    console.error(
      "approveStep error:",
      error
    );

    return response(500, {
      ok: false,
      message: "Internal error in approveStep",
      error:
        error?.message ||
        String(error),
    });
  }
}