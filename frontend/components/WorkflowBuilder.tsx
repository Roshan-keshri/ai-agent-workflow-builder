"use client";

import React, { useState } from "react";
import { useMutation, gql } from "@apollo/client";
import { useOrg } from "@/contexts/OrgContext";
import { STEP_TYPES, TRIGGER_TYPES, OWNER_ONLY_STEP_TYPES, OWNER_ONLY_TRIGGER_TYPES } from "@/lib/constants";

const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($org_id: uuid!, $name: String!) {
    insert_workflows_one(object: { org_id: $org_id, name: $name }) {
      id
      name
    }
  }
`;

const ADD_STEP = gql`
  mutation AddStep($workflow_id: uuid!, $step_order: Int!, $type: step_type!, $name: String!, $config: jsonb!) {
    insert_workflow_steps_one(
      object: { workflow_id: $workflow_id, step_order: $step_order, type: $type, name: $name, config: $config }
    ) {
      id
    }
  }
`;

const ADD_TRIGGER = gql`
  mutation AddTrigger($workflow_id: uuid!, $type: trigger_type!, $name: String!, $trigger_key: String, $config: jsonb!) {
    insert_workflow_triggers_one(
      object: { workflow_id: $workflow_id, type: $type, name: $name, trigger_key: $trigger_key, config: $config }
    ) {
      id
      trigger_key
    }
  }
`;

export default function WorkflowBuilder({ onCreated }: { onCreated: (workflowId: string) => void }) {
  const { currentOrgId, currentMembership } = useOrg();
  const role = currentMembership?.role;
  const canCreate = role === "owner" || role === "editor";

  const [name, setName] = useState("");
  const [steps, setSteps] = useState<{ type: string; name: string; config: string }[]>([
    { type: "llm_call", name: "Call LLM", config: "{}" },
  ]);
  const [triggerType, setTriggerType] = useState<string>("manual");

  const [createWorkflow, { loading: creating }] = useMutation(CREATE_WORKFLOW);
  const [addStep] = useMutation(ADD_STEP);
  const [addTrigger] = useMutation(ADD_TRIGGER);

  if (!canCreate) {
    return <div className="p-4 bg-gray-50 border rounded text-sm text-gray-500">Viewers cannot create workflows.</div>;
  }

  const addStepRow = () => setSteps([...steps, { type: "llm_call", name: "", config: "{}" }]);
  const removeStepRow = (i: number) => setSteps(steps.filter((_, idx) => idx !== i));
  const updateStep = (i: number, patch: Partial<{ type: string; name: string; config: string }>) =>
    setSteps(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const handleSubmit = async () => {
    if (!currentOrgId || !name.trim()) return;
    try {
      const wfRes = await createWorkflow({ variables: { org_id: currentOrgId, name } });
      const workflowId = wfRes.data?.insert_workflows_one?.id;
      if (!workflowId) return;

      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        let parsedConfig = {};
        try {
          parsedConfig = JSON.parse(s.config || "{}");
        } catch {
          parsedConfig = {};
        }
        await addStep({
          variables: {
            workflow_id: workflowId,
            step_order: i + 1,
            type: s.type,
            name: s.name || s.type,
            config: parsedConfig,
          },
        });
      }

      await addTrigger({
        variables: {
          workflow_id: workflowId,
          type: triggerType,
          name: `${triggerType} trigger`,
          trigger_key: triggerType === "webhook" ? crypto.randomUUID() : null,
          config: {},
        },
      });

      setName("");
      setSteps([{ type: "llm_call", name: "Call LLM", config: "{}" }]);
      onCreated(workflowId);
    } catch (err: any) {
      alert(`Failed to create workflow: ${err.message}`);
    }
  };

  return (
    <div className="bg-white border rounded-xl p-6 shadow-sm space-y-5">
      <h3 className="text-lg font-semibold text-gray-900">New workflow</h3>

      <input
        placeholder="Workflow name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full border rounded px-3 py-2 text-sm"
      />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">Steps</label>
          <button onClick={addStepRow} type="button" className="text-xs text-blue-600 hover:underline">
            + Add step
          </button>
        </div>

        {steps.map((s, i) => {
          const restricted = OWNER_ONLY_STEP_TYPES.includes(s.type) && role !== "owner";
          return (
            <div key={i} className="border rounded-lg p-3 bg-gray-50 space-y-2">
              <div className="flex gap-2">
                <select
                  value={s.type}
                  onChange={(e) => updateStep(i, { type: e.target.value })}
                  className="border rounded px-2 py-1 text-xs bg-white"
                >
                  {STEP_TYPES.map((t) => (
                    <option key={t} value={t} disabled={OWNER_ONLY_STEP_TYPES.includes(t) && role !== "owner"}>
                      {t}
                      {OWNER_ONLY_STEP_TYPES.includes(t) ? " (owner only)" : ""}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="Step name"
                  value={s.name}
                  onChange={(e) => updateStep(i, { name: e.target.value })}
                  className="flex-1 border rounded px-2 py-1 text-xs"
                />
                <button onClick={() => removeStepRow(i)} type="button" className="text-xs text-red-500">
                  Remove
                </button>
              </div>
              <textarea
                placeholder='Config JSON (e.g. {"prompt": "..."})'
                value={s.config}
                onChange={(e) => updateStep(i, { config: e.target.value })}
                className="w-full border rounded px-2 py-1 text-xs font-mono"
                rows={2}
              />
              {restricted && <p className="text-xs text-red-500">Only an owner can add a {s.type} step.</p>}
            </div>
          );
        })}
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">Trigger</label>
        <select
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value)}
          className="border rounded px-2 py-1 text-xs bg-white"
        >
          {TRIGGER_TYPES.map((t) => (
            <option key={t} value={t} disabled={OWNER_ONLY_TRIGGER_TYPES.includes(t) && role !== "owner"}>
              {t}
              {OWNER_ONLY_TRIGGER_TYPES.includes(t) ? " (owner only)" : ""}
            </option>
          ))}
        </select>
      </div>

      <button
        disabled={creating || !name.trim()}
        onClick={handleSubmit}
        className="w-full py-2 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700 transition disabled:opacity-50"
      >
        {creating ? "Creating..." : "Create workflow"}
      </button>
    </div>
  );
}