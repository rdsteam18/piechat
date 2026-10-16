"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PublicFooter, PublicHeader } from "@/components/public-site";
import { supabase, getValidSession } from "@/lib/supabase";

const features = [
  {
    number: "01",
    title: "Personal conversations",
    description:
      "Keep one-to-one conversations organised and easy to return to.",
  },
  {
    number: "02",
    title: "Groups that bring people together",
    description:
      "Create group conversations for friends, classmates and shared interests.",
  },
  {
    number: "03",
    title: "Share moments and media",
    description:
      "Share supported photos, videos, files and voice messages with your contacts.",
  },
  {
    number: "04",
    title: "Voice and video calls",
    description:
      "Make conversations more personal with calling features as they become available.",
  },
  {
    number: "05",
    title: "Find people by username",
    description:
      "Discover people and manage friend requests through your PieChat account.",
  },
  {
    number: "06",
    title: "Account and privacy controls",
    description:
      "Manage your profile, discoverability and notification preferences in one place.",
  },
];

export default function HomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;

    async function checkSession() {
      const session = await getValidSession();
      if (!active) return;
      if (session) {
        router.replace("/dashboard");
      } else {
        setChecking(false);
      }
    }

    void checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (
        session &&
        (event === "SIGNED_IN" ||
          event === "INITIAL_SESSION" ||
          event === "TOKEN_REFRESHED")
      ) {
        router.replace("/dashboard");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <PublicHeader />

      <main>
        <section className="container-page pb-20 pt-20 sm:pb-28 sm:pt-28">
          <div className="max-w-4xl">
            <p className="eyebrow">Meet PieChat</p>

            <h1 className="heading-display mt-6">
              Your conversations,
              <br />
              all in one place.
            </h1>

            <p className="body-copy mt-6 max-w-2xl">
              A communication space for friends, classmates and groups.
              Chat, share media, discover people and stay connected through
              a simple, familiar experience.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/auth" className="button-primary">
                Get started
              </Link>

              <a href="#features" className="button-secondary">
                Explore features
              </a>
            </div>

            <p className="mt-5 max-w-xl text-sm leading-6 text-[var(--muted)]">
              Create an account with your email and choose a unique
              username. Additional sign-in options are available when
              configured for your account.
            </p>
          </div>
        </section>

        <section
          id="features"
          className="border-y border-[var(--border)] bg-[var(--surface)]"
        >
          <div className="container-page section-space">
            <div className="max-w-2xl">
              <p className="eyebrow">Features</p>
              <h2 className="heading-section mt-4">
                Everything starts with a conversation.
              </h2>
              <p className="body-copy mt-4">
                A clear place for everyday messaging and the tools that
                help people stay connected.
              </p>
            </div>

            <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <article
                  key={feature.number}
                  className="border-t border-[var(--border)] pt-5"
                >
                  <p className="text-sm font-semibold text-[var(--primary)]">
                    {feature.number}
                  </p>

                  <h3 className="mt-4 text-lg font-semibold tracking-tight">
                    {feature.title}
                  </h3>

                  <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                    {feature.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="container-page section-space">
          <div className="max-w-3xl">
            <p className="eyebrow">Designed around people</p>

            <h2 className="heading-section mt-4">
              A familiar space to stay in touch.
            </h2>

            <p className="body-copy mt-5">
              Find friends through usernames, start conversations and
              manage your account from one place. PieChat is being built
              in stages, with core communication features taking priority.
            </p>

            <Link href="/auth" className="button-primary mt-7">
              Create your account
            </Link>
          </div>
        </section>

        <section className="border-y border-[var(--border)] bg-[#edf1eb]">
          <div className="container-page section-space">
            <div className="max-w-3xl">
              <p className="eyebrow">Privacy and control</p>

              <h2 className="heading-section mt-4">
                Know how your account is managed.
              </h2>

              <p className="body-copy mt-5">
                Review the terms of using PieChat and learn what account
                information and communication data the service handles.
                Our published policies should reflect the features that
                are actually implemented.
              </p>

              <div className="mt-6 flex flex-wrap gap-5 text-sm font-semibold">
                <Link
                  href="/privacy"
                  className="underline underline-offset-4"
                >
                  Read Privacy Policy
                </Link>
                <Link
                  href="/terms"
                  className="underline underline-offset-4"
                >
                  Read Terms of Service
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="container-page py-20 sm:py-24">
          <div className="flex flex-col items-start justify-between gap-7 sm:flex-row sm:items-center">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Start with your people.
              </h2>
              <p className="body-copy mt-4">
                Set up your account and choose a username to get started.
              </p>
            </div>

            <Link href="/auth" className="button-primary shrink-0">
              Join PieChat
            </Link>
          </div>
        </section>
      </main>

      <PublicFooter />
    </>
  );
}
