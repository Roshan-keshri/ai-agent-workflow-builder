"use client";

import React, { useEffect, useState } from "react";
import {
  useAuthenticationStatus,
  useSignInEmailPassword,
  useSignUpEmailPassword,
} from "@nhost/react";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const { isLoading, isAuthenticated } = useAuthenticationStatus();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const { signInEmailPassword, isLoading: signingIn, error: signInError } = useSignInEmailPassword();
  const { signUpEmailPassword, isLoading: signingUp, error: signUpError } = useSignUpEmailPassword();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Render the exact same "loading" markup on server and on the client's
  // first paint, regardless of real auth state, to avoid a hydration mismatch.
  if (!mounted || isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>;
  }

  if (isAuthenticated) return <>{children}</>;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "signin") {
      await signInEmailPassword(email, password);
    } else {
      await signUpEmailPassword(email, password);
    }
  };

  const error = mode === "signin" ? signInError : signUpError;
  const busy = signingIn || signingUp;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl shadow-sm w-full max-w-sm space-y-4 border">
        <h1 className="text-xl font-bold text-gray-900">{mode === "signin" ? "Sign in" : "Create account"}</h1>
        <input
  type="email"
  placeholder="Email"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  required
  className="w-full border rounded px-3 py-2 text-sm text-gray-900 bg-white placeholder-gray-400"
/><input
  type="password"
  placeholder="Password"
  value={password}
  onChange={(e) => setPassword(e.target.value)}
  required
  minLength={8}
  className="w-full border rounded px-3 py-2 text-sm text-gray-900 bg-white placeholder-gray-400"
/>
        {error && <p className="text-xs text-red-600">{error.message}</p>}
        <button
          disabled={busy}
          type="submit"
          className="w-full py-2 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700 transition disabled:opacity-50"
        >
          {busy ? "Please wait..." : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="w-full text-xs text-blue-600 hover:underline"
        >
          {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}