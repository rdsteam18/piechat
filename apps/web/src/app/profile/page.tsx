"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Profile = {
  username: string;
  display_name: string;
  bio: string;
};

export default function ProfilePage() {
  const router = useRouter();

  const [profile, setProfile] = useState<Profile>({
    username: "",
    display_name: "",
    bio: "",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      const { data: authData, error: authError } =
        await supabase.auth.getUser();

      if (authError || !authData.user) {
        router.replace("/auth");
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("username, display_name, bio")
        .eq("id", authData.user.id)
        .single();

      if (!active) return;

      if (error) {
        setStatus(`Could not load profile: ${error.message}`);
      } else {
        setProfile({
          username: data.username,
          display_name: data.display_name,
          bio: data.bio,
        });
      }

      setLoading(false);
    }

    void loadProfile();

    return () => {
      active = false;
    };
  }, [router]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setStatus("");

    const username = profile.username.trim().toLowerCase();
    const displayName = profile.display_name.trim();
    const bio = profile.bio.trim();

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      setStatus(
        "Username must be 3–24 characters and contain only letters, numbers, and underscores."
      );
      setSaving(false);
      return;
    }

    if (!displayName || displayName.length > 60) {
      setStatus("Display name is required and must be at most 60 characters.");
      setSaving(false);
      return;
    }

    if (bio.length > 160) {
      setStatus("Bio must be 160 characters or fewer.");
      setSaving(false);
      return;
    }

    try {
      const { data: authData, error: authError } =
        await supabase.auth.getUser();

      if (authError || !authData.user) {
        router.replace("/auth");
        return;
      }

      const { error } = await supabase
        .from("profiles")
        .update({
          username,
          display_name: displayName,
          bio,
          updated_at: new Date().toISOString(),
        })
        .eq("id", authData.user.id);

      if (error) {
        if (error.code === "23505") {
          setStatus("That username is already taken. Try another one.");
        } else {
          setStatus(`Could not save profile: ${error.message}`);
        }
      } else {
        setStatus("Profile saved successfully.");
        setProfile({ username, display_name: displayName, bio });
      }
    } catch {
      setStatus("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="p-8">Loading profile...</main>;
  }

  return (
    <main className="mx-auto max-w-xl p-6 sm:p-8">
      <h1 className="text-3xl font-bold">Your Profile</h1>
      <p className="mt-2 text-gray-600">
        Choose a username your friends can find.
      </p>

      <form onSubmit={saveProfile} className="mt-6 space-y-5">
        <div>
          <label htmlFor="username" className="mb-1 block text-sm font-medium">
            Username
          </label>
          <div className="flex items-center rounded-lg border px-3">
            <span className="text-gray-500">@</span>
            <input
              id="username"
              value={profile.username}
              onChange={(e) =>
                setProfile({ ...profile, username: e.target.value })
              }
              minLength={3}
              maxLength={24}
              required
              className="w-full px-2 py-3 outline-none"
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Letters, numbers and underscores only.
          </p>
        </div>

        <div>
          <label htmlFor="displayName" className="mb-1 block text-sm font-medium">
            Display name
          </label>
          <input
            id="displayName"
            value={profile.display_name}
            onChange={(e) =>
              setProfile({ ...profile, display_name: e.target.value })
            }
            maxLength={60}
            required
            className="w-full rounded-lg border px-3 py-3 outline-none"
          />
        </div>

        <div>
          <label htmlFor="bio" className="mb-1 block text-sm font-medium">
            Bio
          </label>
          <textarea
            id="bio"
            value={profile.bio}
            onChange={(e) =>
              setProfile({ ...profile, bio: e.target.value })
            }
            maxLength={160}
            rows={3}
            className="w-full rounded-lg border px-3 py-3 outline-none"
            placeholder="A little about you..."
          />
          <p className="mt-1 text-right text-xs text-gray-500">
            {profile.bio.length}/160
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-black px-5 py-3 font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save profile"}
        </button>
      </form>

      {status && (
        <p role="status" aria-live="polite" className="mt-4 break-words rounded-lg border p-3 text-sm">
          {status}
        </p>
      )}

      <button
        type="button"
        onClick={() => router.push("/dashboard")}
        className="mt-4 text-sm underline"
      >
        Back to dashboard
      </button>
    </main>
  );
}
