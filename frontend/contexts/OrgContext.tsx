"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useQuery, gql } from "@apollo/client";
import { useUserId, useAuthenticated } from "@nhost/react";

const GET_MY_ORGS = gql`
  query GetMyOrgs($user_id: uuid!) {
    org_members(where: { user_id: { _eq: $user_id } }) {
      id
      role
      org_id
      organization {
        id
        name
        quota_used
        quota_allowed
      }
    }
  }
`;

export type OrgMembership = {
  org_id: string;
  role: "owner" | "editor" | "viewer";
  organization: { id: string; name: string; quota_used: number; quota_allowed: number };
};

type OrgContextValue = {
  memberships: OrgMembership[];
  currentOrgId: string | null;
  setCurrentOrgId: (id: string) => void;
  currentMembership: OrgMembership | null;
  loading: boolean;
  refetch: () => void;
};

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const authenticated = useAuthenticated();
  const userId = useUserId();
  const [currentOrgId, setCurrentOrgIdState] = useState<string | null>(null);

  const { data, loading, refetch } = useQuery(GET_MY_ORGS, {
    variables: { user_id: userId },
    skip: !authenticated || !userId,
  });

  const memberships: OrgMembership[] = data?.org_members || [];

  useEffect(() => {
    if (!currentOrgId && memberships.length > 0) {
      setCurrentOrgIdState(memberships[0].org_id);
    }
  }, [memberships, currentOrgId]);

  const currentMembership = memberships.find((m) => m.org_id === currentOrgId) || null;

  return (
    <OrgContext.Provider
      value={{
        memberships,
        currentOrgId,
        setCurrentOrgId: setCurrentOrgIdState,
        currentMembership,
        loading,
        refetch,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within OrgProvider");
  return ctx;
}