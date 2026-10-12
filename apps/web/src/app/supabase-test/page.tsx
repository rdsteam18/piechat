"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function SupabaseTestPage() {
  const [status, setStatus] = useState("Not tested");
  const [loading, setLoading] = useState(false);

  async function testConnection() {
    setLoading(true);
    setStatus("Connecting to Supabase...");

    try {
      const { error } = await supabase
        .from("profiles")
        .select("id")
        .limit(1);

      if (error) {
        setStatus(`Connection/query error: ${error.message}`);
      } else {
        setStatus(
          "Connected successfully. Supabase responded to the query."
        );
      }
    } catch {
      setStatus(
        "Connection failed. Check your URL, key, and network."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold">
        PieChat — Supabase Test
      </h1>

      <p className="mt-3 text-gray-600">
        Test the connection between the web app and Supabase.
      </p>

      <button
        onClick={testConnection}
        disabled={loading}
        className="mt-6 rounded-lg bg-black px-5 py-3 text-white disabled:opacity-50"
      >
        {loading ? "Testing..." : "Test Connection"}
      </button>

      <p className="mt-5 break-words rounded-lg border p-4">
        Status: {status}
      </p>
    </main>
  );
}
