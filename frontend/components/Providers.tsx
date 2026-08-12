"use client";

import React from "react";
import { NhostClient, NhostProvider } from "@nhost/react";
import { NhostApolloProvider } from "@nhost/react-apollo";

const nhost = new NhostClient({
  subdomain: process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || "kntgpedziywsbdheflul",
  region: process.env.NEXT_PUBLIC_NHOST_REGION || "ap-south-1",
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NhostProvider nhost={nhost}>
      <NhostApolloProvider nhost={nhost as any}>
        {children}
      </NhostApolloProvider>
    </NhostProvider>
  );
}