"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { gql, useQuery } from "@apollo/client";
import {
  useAuthenticated,
  useUserId,
} from "@nhost/react";


// --------------------------------------------------
// GraphQL
// --------------------------------------------------

const GET_MY_ORGS = gql`
  query GetMyOrgs($user_id: uuid!) {
    org_members(
      where: {
        user_id: { _eq: $user_id }
      }
    ) {
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


// --------------------------------------------------
// Types
// --------------------------------------------------

export type OrgRole =
  | "owner"
  | "editor"
  | "viewer";

export type OrgMembership = {
  id: string;
  org_id: string;
  role: OrgRole;

  organization: {
    id: string;
    name: string;
    quota_used: number;
    quota_allowed: number;
  };
};

type OrgContextValue = {
  memberships: OrgMembership[];

  currentOrgId: string | null;

  setCurrentOrgId: (id: string) => void;

  currentMembership: OrgMembership | null;

  loading: boolean;

  error: any;

  refetch: () => void;
};


// --------------------------------------------------
// Context
// --------------------------------------------------

const OrgContext =
  createContext<OrgContextValue | null>(null);


// --------------------------------------------------
// Provider
// --------------------------------------------------

export function OrgProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const authenticated = useAuthenticated();
  const userId = useUserId();

  const [
    currentOrgId,
    setCurrentOrgIdState,
  ] = useState<string | null>(null);


  // ------------------------------------------------
  // Get organizations for logged-in user
  // ------------------------------------------------

  const {
    data,
    loading,
    error,
    refetch,
  } = useQuery(GET_MY_ORGS, {
    variables: {
      user_id: userId,
    },

    skip:
      !authenticated ||
      !userId,

    fetchPolicy: "network-only",
  });


  // ------------------------------------------------
  // Memberships
  // ------------------------------------------------

  const memberships: OrgMembership[] =
    data?.org_members ?? [];


  // ------------------------------------------------
  // Automatically select first organization
  // ------------------------------------------------

  useEffect(() => {
    if (
      memberships.length > 0 &&
      !currentOrgId
    ) {
      setCurrentOrgIdState(
        memberships[0].org_id
      );
    }
  }, [
    memberships,
    currentOrgId,
  ]);


  // ------------------------------------------------
  // Current membership
  // ------------------------------------------------

  const currentMembership =
    memberships.find(
      (membership) =>
        membership.org_id === currentOrgId
    ) ?? null;


  // ------------------------------------------------
  // Change organization
  // ------------------------------------------------

  const setCurrentOrgId = (id: string) => {
    setCurrentOrgIdState(id);
  };


  // ------------------------------------------------
  // Debug
  // ------------------------------------------------

  useEffect(() => {
    console.log("OrgContext:", {
      authenticated,
      userId,
      loading,
      memberships,
      currentOrgId,
      currentMembership,
      error: error?.message ?? null,
    });
  }, [
    authenticated,
    userId,
    loading,
    memberships,
    currentOrgId,
    currentMembership,
    error,
  ]);


  // ------------------------------------------------
  // Provider
  // ------------------------------------------------

  return (
    <OrgContext.Provider
      value={{
        memberships,
        currentOrgId,
        setCurrentOrgId,
        currentMembership,
        loading,
        error,
        refetch,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}


// --------------------------------------------------
// Hook
// --------------------------------------------------

export function useOrg() {
  const context =
    useContext(OrgContext);

  if (!context) {
    throw new Error(
      "useOrg must be used within OrgProvider"
    );
  }

  return context;
}