"use client";

import React from "react";
import { useSubscription, useMutation, gql } from "@apollo/client";

const SUBSCRIBE_RUN_PROGRESS = gql`
  subscription OnWorkflowRunUpdated($workflow_run_id: uuid!) {
    workflow_runs_by_pk(id: $workflow_run_id) {
      id
      status
      started_by
      created_at
      step_runs(order_by: { created_at: asc }) {
        id
        status
        attempt_count
        output
        error
        approved_by
        approved_at
        workflow_step {
          id
          type
          name
          step_order
        }
      }
    }
  }
`;

const APPROVE_STEP_MUTATION = gql`
  mutation ApproveStep($step_run_id: uuid!, $decision: String!) {
    approveStep(step_run_id: $step_run_id, decision: $decision) {
      ok
      message
      step_run_id
      workflow_run_id
    }
  }
`;

const STATUS_STYLES: Record<string, string> = {
  success: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800 animate-pulse",
  failed: "bg-red-100 text-red-800",
  running: "bg-blue-100 text-blue-800",
  pending: "bg-gray-100 text-gray-700",
};

const STEP_STATUS_STYLES: Record<string, string> = {
  success: "bg-green-200 text-green-900",
  failed: "bg-red-200 text-red-900",
  running: "bg-blue-200 text-blue-900",
  pending: "bg-gray-200 text-gray-700",
  paused: "bg-yellow-200 text-yellow-900 animate-pulse",
  skipped: "bg-gray-200 text-gray-500",
};

export default function LiveExecutionViewer({
  workflowRunId,
  userRole,
}: {
  workflowRunId: string;
  userRole: string;
}) {
  const { data, loading, error } = useSubscription(SUBSCRIBE_RUN_PROGRESS, {
    variables: { workflow_run_id: workflowRunId },
    skip: !workflowRunId,
  });

  const [approveStep, { loading: approving }] = useMutation(APPROVE_STEP_MUTATION);

  if (!workflowRunId) return <div className="text-gray-500 italic">Select or trigger a run to view progress.</div>;
  if (loading && !data) return <div className="text-blue-600 animate-pulse">Connecting to live execution stream...</div>;
  if (error) return <div className="text-red-500">Subscription error: {error.message}</div>;

  const run = data?.workflow_runs_by_pk;
  if (!run) return <div className="text-gray-500 italic">Run not found.</div>;

  const handleApprove = async (stepRunId: string, decision: "approved" | "rejected") => {
    try {
      const res = await approveStep({ variables: { step_run_id: stepRunId, decision } });
      if (!res.data?.approveStep?.ok) {
        alert(res.data?.approveStep?.message || "Approval failed");
      }
    } catch (err: any) {
      alert(`Approval error: ${err.message}`);
    }
  };

  return (
    <div className="bg-white border rounded-xl p-6 shadow-sm space-y-6">
      <div className="flex justify-between items-center border-b pb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Execution monitor</h3>
          <p className="text-xs text-gray-500 font-mono">Run ID: {run.id}</p>
        </div>
        <span
          className={`px-3 py-1 text-xs font-bold rounded-full uppercase ${
            STATUS_STYLES[run.status] || "bg-gray-100 text-gray-700"
          }`}
        >
          {run.status}
        </span>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-700">Step progress</h4>
        {run.step_runs.map((step: any) => {
          // ✅ fixed: key off the real `paused` step_run_status value
          // instead of inferring pause state from type === "approval_gate" && status === "pending"
          const awaitingApproval = step.status === "paused";

          return (
            <div key={step.id} className="border rounded-lg p-4 bg-gray-50 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  #{step.workflow_step?.step_order} {step.workflow_step?.name}
                </p>
                <p className="text-xs text-gray-500">
                  {step.workflow_step?.type} · attempt {step.attempt_count}
                </p>
                {step.error && <p className="text-xs text-red-500 mt-1">{step.error}</p>}
              </div>

              <div className="flex items-center space-x-3">
                <span
                  className={`px-2 py-1 text-xs font-medium rounded ${
                    STEP_STATUS_STYLES[step.status] || "bg-gray-200 text-gray-800"
                  }`}
                >
                  {awaitingApproval ? "awaiting approval" : step.status}
                </span>

                {awaitingApproval &&
                  (userRole === "viewer" ? (
                    <span className="text-xs text-red-500 italic">Viewers cannot approve</span>
                  ) : (
                    <div className="flex space-x-2">
                      <button
                        disabled={approving}
                        onClick={() => handleApprove(step.id, "approved")}
                        className="px-3 py-1 bg-green-600 text-white text-xs font-semibold rounded hover:bg-green-700 transition disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        disabled={approving}
                        onClick={() => handleApprove(step.id, "rejected")}
                        className="px-3 py-1 bg-red-600 text-white text-xs font-semibold rounded hover:bg-red-700 transition disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}