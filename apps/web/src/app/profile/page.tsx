"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  validateUsername,
  validateDisplayName,
  validateBio,
  validateAvatarFile,
  uploadAvatar,
  removeAvatar,
  MAX_BIO_LENGTH,
} from "@/lib/profile-utils";
import {
  User,
  Shield,
  Palette,
  Bell,
  Download,
  Camera,
  Trash2,
  ArrowLeft,
  Check,
  AlertCircle,
  LogOut,
  KeyRound,
  Ban,
  Sun,
  Moon,
  Laptop,
  Volume2,
  VolumeX,
  Smartphone,
  Info,
  Calendar,
  Mail,
  Fingerprint,
} from "lucide-react";

type ProfileData = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  created_at: string;
};

type BlockedUser = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
};

type SettingsTab = "profile" | "security" | "appearance" | "notifications" | "install";

export default function ProfilePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tab State
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  // Auth User
  const [userId, setUserId] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string>("");

  // Loaded Profile
  const [initialProfile, setInitialProfile] = useState<ProfileData | null>(null);
  const [profile, setProfile] = useState<ProfileData>({
    id: "",
    username: "",
    display_name: "",
    bio: "",
    avatar_url: null,
    created_at: "",
  });

  // Avatar Upload State
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isRemovingAvatar, setIsRemovingAvatar] = useState(false);

  // Status & Loading State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Blocked Users State
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loadingBlocked, setLoadingBlocked] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  // Password reset email state
  const [sendingReset, setSendingReset] = useState(false);

  // Appearance Theme State
  const [themePreference, setThemePreference] = useState<"light" | "dark" | "system">("system");

  // Notifications State
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default");
  const [soundEnabled, setSoundEnabled] = useState(true);

  // PWA Standalone Detection
  const [isStandalone, setIsStandalone] = useState(false);

  // Unsaved changes check
  const isDirty =
    initialProfile !== null &&
    (profile.username !== initialProfile.username ||
      profile.display_name !== initialProfile.display_name ||
      profile.bio !== initialProfile.bio ||
      avatarFile !== null ||
      isRemovingAvatar);

  // 1. Initial Load: Auth, Profile, Theme, PWA status
  useEffect(() => {
    let active = true;

    async function loadUserAndProfile() {
      setLoading(true);
      setStatusMessage(null);

      let authUser: { id: string; email?: string } | null = null;
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user) {
        authUser = sessionData.session.user;
      } else {
        const { data: authData } = await supabase.auth.getUser();
        if (authData?.user) authUser = authData.user;
      }

      if (!authUser) {
        router.replace("/auth");
        return;
      }

      if (!active) return;
      setUserId(authUser.id);
      setUserEmail(authUser.email || "");

      // Load Profile
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, bio, avatar_url, created_at")
        .eq("id", authUser.id)
        .single();

      if (!active) return;

      if (error) {
        setStatusMessage({
          type: "error",
          text: `Could not load profile: ${error.message}`,
        });
      } else if (data) {
        const loaded: ProfileData = {
          id: data.id,
          username: data.username || "",
          display_name: data.display_name || "",
          bio: data.bio || "",
          avatar_url: data.avatar_url,
          created_at: data.created_at || "",
        };
        setProfile(loaded);
        setInitialProfile(loaded);
        setAvatarPreview(loaded.avatar_url);
      }

      // Check current theme preference
      try {
        const savedTheme = localStorage.getItem("piechat_theme");
        if (savedTheme === "dark" || savedTheme === "light") {
          setThemePreference(savedTheme);
        } else {
          setThemePreference("system");
        }
      } catch {
        setThemePreference("system");
      }

      // Check sound preference
      try {
        const soundPref = localStorage.getItem("piechat_sound_enabled");
        setSoundEnabled(soundPref !== "false");
      } catch {
        setSoundEnabled(true);
      }

      // Check Notification permission
      if (typeof window !== "undefined" && "Notification" in window) {
        setNotifPermission(Notification.permission);
      }

      // Check Standalone PWA mode
      if (typeof window !== "undefined") {
        const standaloneCheck =
          window.matchMedia("(display-mode: standalone)").matches ||
          (window.navigator as unknown as { standalone?: boolean }).standalone === true;
        setIsStandalone(standaloneCheck);
      }

      setLoading(false);
    }

    void loadUserAndProfile();

    return () => {
      active = false;
    };
  }, [router]);

  // Load Blocked Users when Security Tab is selected
  useEffect(() => {
    if (activeTab !== "security" || !userId) return;

    let active = true;
    async function loadBlockedUsers() {
      setLoadingBlocked(true);
      try {
        const { data: friendships, error: friendErr } = await supabase
          .from("friendships")
          .select("id, addressee_id")
          .eq("requester_id", userId)
          .eq("status", "blocked");

        if (friendErr) throw friendErr;

        const blockedIds = (friendships || []).map((f) => f.addressee_id);
        if (blockedIds.length === 0) {
          if (active) setBlockedUsers([]);
          return;
        }

        const { data: profiles, error: profErr } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .in("id", blockedIds);

        if (profErr) throw profErr;

        if (active) {
          setBlockedUsers((profiles || []) as BlockedUser[]);
        }
      } catch {
        // Handled silently
      } finally {
        if (active) setLoadingBlocked(false);
      }
    }

    void loadBlockedUsers();

    return () => {
      active = false;
    };
  }, [activeTab, userId]);

  // Handle Avatar Selection
  function handleAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateAvatarFile(file);
    if (!validation.valid) {
      setStatusMessage({ type: "error", text: validation.error || "Invalid file" });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setStatusMessage(null);
    setAvatarFile(file);
    setIsRemovingAvatar(false);
    const objectUrl = URL.createObjectURL(file);
    setAvatarPreview(objectUrl);
  }

  // Handle Avatar Removal
  function handleRemoveAvatar() {
    setAvatarFile(null);
    setAvatarPreview(null);
    setIsRemovingAvatar(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Reset/Cancel Edits
  function handleCancelChanges() {
    if (!initialProfile) return;
    setProfile(initialProfile);
    setAvatarFile(null);
    setAvatarPreview(initialProfile.avatar_url);
    setIsRemovingAvatar(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setStatusMessage(null);
  }

  // Save Profile Form
  async function handleSaveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatusMessage(null);

    // 1. Client-side validations
    const usernameValidation = validateUsername(profile.username);
    if (!usernameValidation.valid) {
      setStatusMessage({ type: "error", text: usernameValidation.error! });
      return;
    }

    const displayNameValidation = validateDisplayName(profile.display_name);
    if (!displayNameValidation.valid) {
      setStatusMessage({ type: "error", text: displayNameValidation.error! });
      return;
    }

    const bioValidation = validateBio(profile.bio);
    if (!bioValidation.valid) {
      setStatusMessage({ type: "error", text: bioValidation.error! });
      return;
    }

    setSaving(true);

    try {
      let finalAvatarUrl = initialProfile?.avatar_url || null;

      // Handle Avatar upload or removal
      if (avatarFile) {
        setUploadingAvatar(true);
        const { url: newUrl } = await uploadAvatar(supabase, userId, avatarFile);
        finalAvatarUrl = newUrl;

        // Clean up previous avatar if it was stored in our bucket
        if (initialProfile?.avatar_url && initialProfile.avatar_url !== newUrl) {
          void removeAvatar(supabase, initialProfile.avatar_url, userId);
        }
        setUploadingAvatar(false);
      } else if (isRemovingAvatar) {
        if (initialProfile?.avatar_url) {
          await removeAvatar(supabase, initialProfile.avatar_url, userId);
        }
        finalAvatarUrl = null;
      }

      // Update Database
      const cleanedUsername = profile.username.trim().toLowerCase();
      const cleanedDisplayName = profile.display_name.trim();
      const cleanedBio = profile.bio.trim();

      const { error } = await supabase
        .from("profiles")
        .update({
          username: cleanedUsername,
          display_name: cleanedDisplayName,
          bio: cleanedBio,
          avatar_url: finalAvatarUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) {
        if (error.code === "23505") {
          setStatusMessage({
            type: "error",
            text: "That username is already taken. Please choose another one.",
          });
        } else {
          setStatusMessage({
            type: "error",
            text: `Could not save profile: ${error.message}`,
          });
        }
        return;
      }

      // Success
      const updated: ProfileData = {
        ...profile,
        username: cleanedUsername,
        display_name: cleanedDisplayName,
        bio: cleanedBio,
        avatar_url: finalAvatarUrl,
      };

      setProfile(updated);
      setInitialProfile(updated);
      setAvatarFile(null);
      setIsRemovingAvatar(false);
      setAvatarPreview(finalAvatarUrl);
      if (fileInputRef.current) fileInputRef.current.value = "";

      setStatusMessage({
        type: "success",
        text: "Your profile changes were saved successfully!",
      });
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setSaving(false);
      setUploadingAvatar(false);
    }
  }

  // Unblock user
  async function handleUnblockUser(targetId: string) {
    setUnblockingId(targetId);
    try {
      const { error } = await supabase.rpc("unblock_user", {
        p_target_user_id: targetId,
      });

      if (error) throw error;

      setBlockedUsers((prev) => prev.filter((u) => u.id !== targetId));
      setStatusMessage({
        type: "success",
        text: "User unblocked successfully.",
      });
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to unblock user.",
      });
    } finally {
      setUnblockingId(null);
    }
  }

  // Password reset email
  async function handleSendPasswordReset() {
    if (!userEmail) return;
    setSendingReset(true);
    setStatusMessage(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
        redirectTo: `${window.location.origin}/auth?reset=true`,
      });

      if (error) throw error;

      setStatusMessage({
        type: "success",
        text: `Password reset link sent to ${userEmail}. Please check your inbox.`,
      });
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to send reset link.",
      });
    } finally {
      setSendingReset(false);
    }
  }

  // Theme changer
  function handleSetTheme(newTheme: "light" | "dark" | "system") {
    setThemePreference(newTheme);
    try {
      localStorage.setItem("piechat_theme", newTheme);
      if (newTheme === "light" || newTheme === "dark") {
        document.documentElement.setAttribute("data-theme", newTheme);
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    } catch {
      // Ignored
    }
  }

  // Toggle Sound
  function handleToggleSound() {
    const nextVal = !soundEnabled;
    setSoundEnabled(nextVal);
    try {
      localStorage.setItem("piechat_sound_enabled", String(nextVal));
    } catch {
      // Ignored
    }
  }

  // Request Notification Permission
  async function handleRequestNotifications() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setStatusMessage({
        type: "error",
        text: "Notifications are not supported in this browser.",
      });
      return;
    }

    try {
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
      if (perm === "granted") {
        setStatusMessage({
          type: "success",
          text: "Notifications enabled! You will be notified of incoming messages.",
        });
      } else {
        setStatusMessage({
          type: "error",
          text: "Notification permission was not granted by your browser.",
        });
      }
    } catch {
      setStatusMessage({
        type: "error",
        text: "Failed to request notification permission.",
      });
    }
  }

  // Logout
  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/auth");
    router.refresh();
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--muted)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
          <p className="text-sm font-medium">Loading your profile…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--foreground)] sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Navigation Top Header */}
        <header className="flex items-center justify-between border-b border-[var(--border)] pb-4">
          <button
            onClick={() => router.push("/dashboard")}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition cursor-pointer"
          >
            <ArrowLeft size={16} />
            <span>Back to Chats</span>
          </button>

          <h1 className="text-lg font-bold tracking-tight sm:text-xl">
            Account & Profile
          </h1>

          <button
            onClick={handleLogout}
            title="Log Out"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition cursor-pointer"
          >
            <LogOut size={14} />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </header>

        {/* Status Feedback Toast */}
        {statusMessage && (
          <div
            role="alert"
            className={`flex items-start gap-3 rounded-xl border p-4 text-sm font-medium transition animate-in fade-in ${
              statusMessage.type === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
            }`}
          >
            {statusMessage.type === "success" ? (
              <Check size={18} className="shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertCircle size={18} className="shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
            )}
            <span className="flex-1 break-words leading-relaxed">{statusMessage.text}</span>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-xs opacity-75 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}

        {/* Prominent Profile Summary Banner */}
        <section className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--primary)] bg-[var(--primary-soft)] text-2xl font-bold text-[var(--primary)] shadow-sm">
                {avatarPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarPreview}
                    alt={profile.display_name || "Profile Photo"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  (profile.display_name || profile.username || "U").slice(0, 1).toUpperCase()
                )}
              </div>

              <div className="min-w-0">
                <h2 className="truncate text-xl font-bold tracking-tight sm:text-2xl">
                  {profile.display_name || "PieChat User"}
                </h2>
                <p className="truncate text-sm font-medium text-[var(--muted)]">
                  @{profile.username || "username"}
                </p>
                {profile.bio && (
                  <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">
                    {profile.bio}
                  </p>
                )}
              </div>
            </div>

            {profile.created_at && (
              <div className="flex items-center gap-1.5 self-start rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--muted)] sm:self-center">
                <Calendar size={13} />
                <span>
                  Member since{" "}
                  {new Date(profile.created_at).toLocaleDateString([], {
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Tab Navigation Navigation Bar */}
        <nav
          aria-label="Settings sections"
          className="flex flex-wrap gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-xs"
        >
          <button
            onClick={() => setActiveTab("profile")}
            className={`flex flex-1 min-w-[120px] items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-xs font-semibold transition cursor-pointer ${
              activeTab === "profile"
                ? "bg-[var(--primary)] text-white shadow-xs"
                : "text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            }`}
          >
            <User size={15} />
            <span>Profile</span>
          </button>

          <button
            onClick={() => setActiveTab("security")}
            className={`flex flex-1 min-w-[120px] items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-xs font-semibold transition cursor-pointer ${
              activeTab === "security"
                ? "bg-[var(--primary)] text-white shadow-xs"
                : "text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            }`}
          >
            <Shield size={15} />
            <span>Security</span>
          </button>

          <button
            onClick={() => setActiveTab("appearance")}
            className={`flex flex-1 min-w-[120px] items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-xs font-semibold transition cursor-pointer ${
              activeTab === "appearance"
                ? "bg-[var(--primary)] text-white shadow-xs"
                : "text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            }`}
          >
            <Palette size={15} />
            <span>Appearance</span>
          </button>

          <button
            onClick={() => setActiveTab("notifications")}
            className={`flex flex-1 min-w-[120px] items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-xs font-semibold transition cursor-pointer ${
              activeTab === "notifications"
                ? "bg-[var(--primary)] text-white shadow-xs"
                : "text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            }`}
          >
            <Bell size={15} />
            <span>Notifications</span>
          </button>

          <button
            onClick={() => setActiveTab("install")}
            className={`flex flex-1 min-w-[120px] items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-xs font-semibold transition cursor-pointer ${
              activeTab === "install"
                ? "bg-[var(--primary)] text-white shadow-xs"
                : "text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            }`}
          >
            <Download size={15} />
            <span>App & Install</span>
          </button>
        </nav>

        {/* TAB 1: EDIT PROFILE */}
        {activeTab === "profile" && (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <h3 className="text-base font-bold tracking-tight">Public Profile Details</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              This information is visible to other PieChat members and friends.
            </p>

            <form onSubmit={handleSaveProfile} className="mt-6 space-y-6">
              {/* Avatar Upload / Change / Remove */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
                  Profile Photo
                </label>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--border)] bg-[var(--surface)] text-xl font-bold text-[var(--primary)] shadow-inner">
                    {avatarPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={avatarPreview}
                        alt="Avatar Preview"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      (profile.display_name || profile.username || "U").slice(0, 1).toUpperCase()
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      id="avatar-file-input"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={handleAvatarChange}
                    />

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold hover:bg-[var(--surface-hover)] transition cursor-pointer"
                    >
                      <Camera size={14} />
                      <span>{avatarPreview ? "Change Photo" : "Upload Photo"}</span>
                    </button>

                    {avatarPreview && (
                      <button
                        type="button"
                        onClick={handleRemoveAvatar}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900/50 bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition cursor-pointer"
                      >
                        <Trash2 size={14} />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                </div>

                <p className="mt-3 text-[11px] text-[var(--muted)]">
                  Supported formats: JPEG, PNG, WebP, GIF. Maximum file size: 5 MB.
                </p>
              </div>

              {/* Username Field */}
              <div>
                <label
                  htmlFor="username"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--muted)]"
                >
                  Username
                </label>
                <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 focus-within:border-[var(--primary)] focus-within:ring-1 focus-within:ring-[var(--primary)] transition">
                  <span className="text-sm font-semibold text-[var(--muted)]">@</span>
                  <input
                    id="username"
                    value={profile.username}
                    onChange={(e) =>
                      setProfile({ ...profile, username: e.target.value.toLowerCase() })
                    }
                    minLength={3}
                    maxLength={24}
                    required
                    placeholder="devdhar"
                    className="w-full bg-transparent px-2.5 py-3 text-sm outline-none font-medium"
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                  3–24 characters. Letters, numbers, and underscores only. Uniquely identifies you.
                </p>
              </div>

              {/* Display Name Field */}
              <div>
                <label
                  htmlFor="displayName"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--muted)]"
                >
                  Display Name
                </label>
                <input
                  id="displayName"
                  value={profile.display_name}
                  onChange={(e) =>
                    setProfile({ ...profile, display_name: e.target.value })
                  }
                  maxLength={60}
                  required
                  placeholder="Your Name"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3.5 py-3 text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition font-medium"
                />
                <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                  The name displayed to friends and conversation members (up to 60 characters).
                </p>
              </div>

              {/* Bio Field */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="bio"
                    className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]"
                  >
                    Bio
                  </label>
                  <span
                    className={`text-xs ${
                      profile.bio.length > MAX_BIO_LENGTH
                        ? "text-red-500 font-bold"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {profile.bio.length} / {MAX_BIO_LENGTH}
                  </span>
                </div>
                <textarea
                  id="bio"
                  value={profile.bio}
                  onChange={(e) =>
                    setProfile({ ...profile, bio: e.target.value })
                  }
                  maxLength={MAX_BIO_LENGTH}
                  rows={3}
                  placeholder="Tell your friends what you're working on or interested in…"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3.5 py-3 text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition leading-relaxed resize-none"
                />
              </div>

              {/* Unsaved Changes Indicator & Form Actions */}
              <div className="flex flex-col gap-3 pt-3 sm:flex-row sm:items-center sm:justify-between border-t border-[var(--border)]">
                <div>
                  {isDirty && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                      <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                      You have unsaved changes
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  {isDirty && (
                    <button
                      type="button"
                      onClick={handleCancelChanges}
                      disabled={saving}
                      className="button-secondary text-xs disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={saving || !isDirty}
                    className="button-primary text-xs disabled:opacity-50 min-w-[130px]"
                  >
                    {saving
                      ? uploadingAvatar
                        ? "Uploading photo…"
                        : "Saving changes…"
                      : "Save Changes"}
                  </button>
                </div>
              </div>
            </form>
          </section>
        )}

        {/* TAB 2: PRIVACY & SECURITY */}
        {activeTab === "security" && (
          <section className="space-y-6">
            {/* Account Credentials Card */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
              <h3 className="text-base font-bold tracking-tight">Account Credentials</h3>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Your authenticated account details on PieChat.
              </p>

              <div className="mt-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--background)] p-3.5 gap-2">
                  <div className="flex items-center gap-2.5 text-xs">
                    <Mail size={16} className="text-[var(--primary)] shrink-0" />
                    <div>
                      <span className="text-[var(--muted)] block">Email Address</span>
                      <span className="font-semibold">{userEmail || "Not available"}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleSendPasswordReset}
                    disabled={sendingReset}
                    className="button-secondary text-xs py-1.5 px-3 self-start sm:self-auto disabled:opacity-50"
                  >
                    <KeyRound size={13} className="mr-1.5 inline" />
                    {sendingReset ? "Sending Link…" : "Reset Password"}
                  </button>
                </div>

                <div className="flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3.5 text-xs">
                  <Fingerprint size={16} className="text-[var(--muted)] shrink-0" />
                  <div className="min-w-0">
                    <span className="text-[var(--muted)] block">User ID (UUID)</span>
                    <span className="font-mono text-[11px] truncate block text-[var(--muted)]">
                      {userId}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Blocked Users Card */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold tracking-tight">Blocked Users</h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Blocked users cannot call you or send you direct messages.
                  </p>
                </div>
                <span className="rounded-full bg-[var(--background)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)] border border-[var(--border)]">
                  {blockedUsers.length}
                </span>
              </div>

              <div className="mt-4">
                {loadingBlocked ? (
                  <p className="py-4 text-center text-xs text-[var(--muted)] animate-pulse">
                    Loading blocked users…
                  </p>
                ) : blockedUsers.length === 0 ? (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 text-center text-xs text-[var(--muted)]">
                    <Ban size={20} className="mx-auto mb-2 opacity-50" />
                    You haven&apos;t blocked any users.
                  </div>
                ) : (
                  <div className="grid gap-2.5">
                    {blockedUsers.map((blocked) => (
                      <div
                        key={blocked.id}
                        className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--background)] p-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-xs font-bold text-[var(--primary)] overflow-hidden">
                            {blocked.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={blocked.avatar_url}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              (blocked.display_name || blocked.username).slice(0, 1).toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold">
                              {blocked.display_name}
                            </p>
                            <p className="truncate text-[11px] text-[var(--muted)]">
                              @{blocked.username}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={unblockingId === blocked.id}
                          onClick={() => handleUnblockUser(blocked.id)}
                          className="button-secondary text-xs px-3 py-1.5 disabled:opacity-50"
                        >
                          {unblockingId === blocked.id ? "Unblocking…" : "Unblock"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Account Deletion Note */}
            <div className="rounded-2xl border border-red-200 dark:border-red-950/60 bg-red-50/50 dark:bg-red-950/20 p-5">
              <h4 className="text-xs font-bold text-red-700 dark:text-red-400 uppercase tracking-wider">
                Account Deletion
              </h4>
              <p className="mt-1 text-xs text-[var(--muted)] leading-relaxed">
                To protect group conversation integrity and encryption keys, account deletion
                requires full cascading cleanup of calls, files, and memberships. Contact your workspace administrator or support if you need permanent data expungement.
              </p>
            </div>
          </section>
        )}

        {/* TAB 3: APPEARANCE */}
        {activeTab === "appearance" && (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <h3 className="text-base font-bold tracking-tight">Theme Preferences</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Choose how PieChat looks to you. Your selection is saved to this device.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* Light Mode */}
              <button
                type="button"
                onClick={() => handleSetTheme("light")}
                className={`flex flex-col items-center gap-3 rounded-xl border p-5 transition cursor-pointer text-left ${
                  themePreference === "light"
                    ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)] ring-2 ring-[var(--primary)]/20"
                    : "border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:border-[var(--primary)]"
                }`}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
                  <Sun size={24} />
                </div>
                <div className="text-center">
                  <span className="font-semibold text-sm block">Light</span>
                  <span className="text-[11px] text-[var(--muted)]">Crisp and bright</span>
                </div>
              </button>

              {/* Dark Mode */}
              <button
                type="button"
                onClick={() => handleSetTheme("dark")}
                className={`flex flex-col items-center gap-3 rounded-xl border p-5 transition cursor-pointer text-left ${
                  themePreference === "dark"
                    ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)] ring-2 ring-[var(--primary)]/20"
                    : "border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:border-[var(--primary)]"
                }`}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                  <Moon size={24} />
                </div>
                <div className="text-center">
                  <span className="font-semibold text-sm block">Dark</span>
                  <span className="text-[11px] text-[var(--muted)]">Easy on the eyes</span>
                </div>
              </button>

              {/* System Mode */}
              <button
                type="button"
                onClick={() => handleSetTheme("system")}
                className={`flex flex-col items-center gap-3 rounded-xl border p-5 transition cursor-pointer text-left ${
                  themePreference === "system"
                    ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)] ring-2 ring-[var(--primary)]/20"
                    : "border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:border-[var(--primary)]"
                }`}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-500/10 text-sky-500">
                  <Laptop size={24} />
                </div>
                <div className="text-center">
                  <span className="font-semibold text-sm block">System</span>
                  <span className="text-[11px] text-[var(--muted)]">Sync with OS</span>
                </div>
              </button>
            </div>
          </section>
        )}

        {/* TAB 4: NOTIFICATIONS */}
        {activeTab === "notifications" && (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm space-y-6">
            <div>
              <h3 className="text-base font-bold tracking-tight">Notification Settings</h3>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Configure browser alerts and sound effects for incoming chats and calls.
              </p>
            </div>

            {/* Browser Permission Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 gap-3">
              <div>
                <span className="text-xs font-bold block">Browser Push Notifications</span>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  Receive notifications when you get incoming calls or messages.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] text-[var(--muted)]">Status:</span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                      notifPermission === "granted"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        : notifPermission === "denied"
                        ? "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                    }`}
                  >
                    {notifPermission === "granted"
                      ? "Enabled"
                      : notifPermission === "denied"
                      ? "Blocked by Browser"
                      : "Permission Needed"}
                  </span>
                </div>
              </div>

              {notifPermission !== "granted" ? (
                <button
                  type="button"
                  onClick={handleRequestNotifications}
                  className="button-primary text-xs py-2 px-3.5 self-start sm:self-auto shrink-0"
                >
                  Enable Notifications
                </button>
              ) : (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold self-start sm:self-auto">
                  ✓ Active
                </span>
              )}
            </div>

            {/* Audio Feedback Row */}
            <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
                  {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                </div>
                <div>
                  <span className="text-xs font-bold block">Call & Message Sounds</span>
                  <span className="text-[11px] text-[var(--muted)]">
                    Play audio ringtones and notification sounds
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleToggleSound}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  soundEnabled ? "bg-[var(--primary)]" : "bg-zinc-300 dark:bg-zinc-700"
                }`}
                role="switch"
                aria-checked={soundEnabled}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    soundEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </section>
        )}

        {/* TAB 5: INSTALL & ABOUT */}
        {activeTab === "install" && (
          <section className="space-y-6">
            {/* Install PWA Card */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold tracking-tight">Progressive Web App (PWA)</h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Install PieChat on your home screen or desktop for native calling and fast access.
                  </p>
                </div>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
                  <Smartphone size={20} />
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
                {isStandalone ? (
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    <Check size={16} />
                    <span>PieChat is running in Standalone App mode!</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-[var(--foreground)] leading-relaxed">
                      You can install PieChat on any smartphone, tablet, or desktop browser.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(new Event("piechat-show-install-prompt"));
                      }}
                      className="button-primary text-xs py-2 px-4"
                    >
                      📲 Launch Install Prompt / Instructions
                    </button>
                  </div>
                )}
              </div>

              {/* Instructions */}
              <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs text-[var(--muted)]">
                <div className="rounded-xl border border-[var(--border)] p-3.5">
                  <span className="font-semibold text-[var(--foreground)] block mb-1">
                    iOS (iPhone / iPad)
                  </span>
                  Tap the <strong className="text-[var(--foreground)]">Share</strong> icon in Safari, then tap{" "}
                  <strong className="text-[var(--foreground)]">&ldquo;Add to Home Screen&rdquo;</strong>.
                </div>
                <div className="rounded-xl border border-[var(--border)] p-3.5">
                  <span className="font-semibold text-[var(--foreground)] block mb-1">
                    Android & Chrome
                  </span>
                  Tap the browser menu <strong className="text-[var(--foreground)]">⋮</strong> and tap{" "}
                  <strong className="text-[var(--foreground)]">&ldquo;Install App&rdquo;</strong>.
                </div>
              </div>
            </div>

            {/* About & Version Info */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Info size={16} className="text-[var(--primary)]" />
                <h3 className="text-base font-bold tracking-tight">About PieChat</h3>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
                  <span className="text-[var(--muted)] block">Version</span>
                  <span className="font-semibold text-[var(--foreground)]">1.0.0</span>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
                  <span className="text-[var(--muted)] block">Realtime</span>
                  <span className="font-semibold text-[var(--foreground)]">WebRTC + Socket.IO</span>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 col-span-2 sm:col-span-1">
                  <span className="text-[var(--muted)] block">Backend & Auth</span>
                  <span className="font-semibold text-[var(--foreground)]">Supabase PostgreSQL</span>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
