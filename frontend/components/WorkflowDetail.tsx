"use client";

import React, { useState } from "react";
import { useMutation, useQuery, gql } from "@apollo/client";
import { useOrg } from "@/contexts/OrgContext";
import LiveExecutionViewer from "@/components/LiveExecutionViewer";

const GET_WORKFLOW_DETAIL = gql`
  query GetWorkflowDetail($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      name
      workflow_steps(order_by: { step_order: asc }) {
        id
        step_order
        type
        name
      }
      workflow_triggers {
        id
        type
        name
        trigger_key
        enabled
      }
      workflow_runs(order_by: { created_at: desc }, limit: 1) {
        id
        status
      }
    }
  }
`;

const TRIGGER_WORKFLOW = gql`
  mutation TriggerWorkflow($workflow_id: uuid!, $trigger_type: String!) {
    triggerWorkflowRun(workflow_id: $workflow_id, trigger_type: $trigger_type, input: {}) {
      ok
      message
      workflow_run_id
      step_count
    }
  }
`;

export default function WorkflowDetail({ workflowId }: { workflowId: string }) {
  const { currentMembership } = useOrg();
  const role = currentMembership?.role;

  const { data, loading, refetch } = useQuery(GET_WORKFLOW_DETAIL, { variables: { id: workflowId } });
  const [triggerRun, { loading: triggering }] = useMutation(TRIGGER_WORKFLOW);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const workflow = data?.workflows_by_pk;

  const handleRun = async () => {
    try {
      const res = await triggerRun({ variables: { workflow_id: workflowId, trigger_type: "manual" } });
      const result = res.data?.triggerWorkflowRun;
      if (!result?.ok) {
        alert(result?.message || "Trigger failed");
        return;
      }
      setActiveRunId(result.workflow_run_id);
      refetch();
    } catch (err: any) {
      alert(`Trigger failed: ${err.message}`);
    }
  };

  if (loading) return <div className="text-gray-500 text-sm">Loading workflow...</div>;
  if (!workflow) return <div className="text-gray-500 text-sm">Workflow not found.</div>;

  const runId = activeRunId || workflow.workflow_runs?.[0]?.id || null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="bg-white border rounded-xl p-6 shadow-sm space-y-4 md:col-span-1">
        <h3 className="text-lg font-semibold text-gray-900">{workflow.name}</h3>

        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1">Steps</p>
          <ol className="space-y-1">
            {workflow.workflow_steps.map((s: any) => (
              <li key={s.id} className="text-xs bg-gray-50 border rounded px-2 py-1">
                {s.step_order}. {s.name} <span className="text-gray-400">({s.type})</span>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1">Triggers</p>
          <ul className="space-y-1">
            {workflow.workflow_triggers.map((t: any) => (
              <li key={t.id} className="text-xs bg-gray-50 border rounded px-2 py-1">
                {t.type} {t.trigger_key && <span className="font-mono text-gray-400">({t.trigger_key})</span>}
              </li>
            ))}
          </ul>
        </div>

        {role === "viewer" ? (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded text-center">
            Viewers cannot trigger runs.
          </div>
        ) : (
          <button
            disabled={triggering}
            onClick={handleRun}
            className="w-full py-2 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700 transition disabled:opacity-50"
          >
            {triggering ? "Starting..." : "Run workflow"}
          </button>
        )}
      </div>

      <div className="md:col-span-2">
        {runId ? (
          <LiveExecutionViewer workflowRunId={runId} userRole={role || "viewer"} />
        ) : (
          <div className="text-gray-500 text-sm italic">No runs yet. Trigger one to see live progress.</div>
        )}
      </div>
    </div>
  );
}