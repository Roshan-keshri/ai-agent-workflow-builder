"use client";

import React, { useState } from "react";
import { useSignOut } from "@nhost/react";
import { useQuery, gql } from "@apollo/client";
import AuthGate from "@/components/AuthGate";
import { OrgProvider, useOrg } from "@/contexts/OrgContext";
import QuotaBar from "@/components/QuotaBar";
import WorkflowBuilder from "@/components/WorkflowBuilder";
import WorkflowDetail from "@/components/WorkflowDetail";

const GET_ORG_WORKFLOWS = gql`
  query GetOrgWorkflows($org_id: uuid!) {
    workflows(where: { org_id: { _eq: $org_id } }, order_by: { created_at: desc }) {
      id
      name
      created_at
    }
  }
`;

function Dashboard() {
  const { signOut } = useSignOut();
  const { memberships, currentOrgId, setCurrentOrgId, currentMembership, loading: orgLoading } = useOrg();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);

  const { data, loading: wfLoading, refetch } = useQuery(GET_ORG_WORKFLOWS, {
    variables: { org_id: currentOrgId },
    skip: !currentOrgId,
  });

  if (orgLoading) return <div className="p-8 text-gray-500">Loading your organizations...</div>;

  if (memberships.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-8 rounded-xl border shadow-sm text-center space-y-2">
          <p className="text-gray-700 font-medium">You're not a member of any organization yet.</p>
          <p className="text-xs text-gray-500">Ask an owner to add you to org_members.</p>
        </div>
      </div>
    );
  }

  const workflows = data?.workflows || [];
  const org = currentMembership?.organization;

  return (
    <div className="min-h-screen bg-gray-100 p-8 space-y-8">
      <header className="bg-white p-6 rounded-xl shadow-sm flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Agent Workflow Builder</h1>
          <p className="text-sm text-gray-500">Multi-tenant execution environment</p>
        </div>

        <div className="flex items-center gap-4">
          {org && <QuotaBar used={org.quota_used} allowed={org.quota_allowed} />}

          <div>
            <label className="text-xs font-bold text-gray-600 block">Organization</label>
            <select
              value={currentOrgId || ""}
              onChange={(e) => {
                setCurrentOrgId(e.target.value);
                setSelectedWorkflowId(null);
              }}
              className="text-sm bg-white border rounded px-2 py-1"
            >
              {memberships.map((m) => (
                <option key={m.org_id} value={m.org_id}>
                  {m.organization.name} ({m.role})
                </option>
              ))}
            </select>
          </div>

          <button onClick={() => signOut()} className="text-xs text-gray-500 hover:underline">
            Sign out
          </button>
        </div>
      </header>

      <main className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-800">Workflows</h2>
          {currentMembership?.role !== "viewer" && (
            <button
              onClick={() => setShowBuilder(!showBuilder)}
              className="text-sm px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition"
            >
              {showBuilder ? "Cancel" : "+ New workflow"}
            </button>
          )}
        </div>

        {showBuilder && (
          <WorkflowBuilder
            onCreated={(id) => {
              setShowBuilder(false);
              setSelectedWorkflowId(id);
              refetch();
            }}
          />
        )}

        {wfLoading ? (
          <p className="text-sm text-gray-500">Loading workflows...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {workflows.map((wf: any) => (
              <button
                key={wf.id}
                onClick={() => setSelectedWorkflowId(wf.id)}
                className={`text-left p-4 bg-white border rounded-xl shadow-sm hover:border-blue-400 transition ${
                  selectedWorkflowId === wf.id ? "border-blue-500 ring-1 ring-blue-500" : ""
                }`}
              >
                <p className="font-semibold text-gray-900 text-sm">{wf.name}</p>
                <p className="text-xs text-gray-400 font-mono mt-1">{wf.id}</p>
              </button>
            ))}
            {workflows.length === 0 && <p className="text-sm text-gray-500 col-span-3">No workflows yet in this org.</p>}
          </div>
        )}

        {selectedWorkflowId && <WorkflowDetail workflowId={selectedWorkflowId} />}
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <AuthGate>
      <OrgProvider>
        <Dashboard />
      </OrgProvider>
    </AuthGate>
  );
}