"use client";

import { useEffect, useState } from "react";
import { Download, X, Share2, Smartphone, CheckCircle } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // 1. Register service worker
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          console.log("PieChat Service Worker registered with scope:", reg.scope);
        })
        .catch((err) => {
          console.warn("Service Worker registration failed:", err);
        });
    }

    // 2. Check if already running in standalone mode (installed PWA)
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    const hasInstalledFlag = localStorage.getItem("piechat_pwa_installed") === "true";

    if (isStandalone || (hasInstalledFlag && isStandalone)) {
      setInstalled(true);
      return;
    }

    // 3. Check temporary dismissal for the current session
    const isDismissedThisSession = sessionStorage.getItem("piechat_install_dismissed") === "true";

    // 4. Detect iOS Safari
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice =
      /iphone|ipad|ipod/.test(userAgent) &&
      !(window as unknown as { MSStream?: unknown }).MSStream;
    const isSafari =
      userAgent.includes("safari") &&
      !userAgent.includes("chrome") &&
      !userAgent.includes("crios") &&
      !userAgent.includes("fxios");

    if (isIOSDevice && isSafari && !isStandalone) {
      setIsIOS(true);
      if (!isDismissedThisSession) {
        // Delay popup slightly to avoid UI flicker
        const timer = setTimeout(() => setIsVisible(true), 2500);
        return () => clearTimeout(timer);
      }
    }

    // 5. Handle standard beforeinstallprompt (Chromium, Edge, Android Chrome, Samsung Internet)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);

      if (!isDismissedThisSession && !isStandalone) {
        // Show after brief delay for smooth UX
        setTimeout(() => {
          setIsVisible(true);
        }, 2000);
      }
    };

    // 6. Handle successful app installation event
    const handleAppInstalled = () => {
      localStorage.setItem("piechat_pwa_installed", "true");
      setInstalled(true);
      setIsVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    // Custom event listener so settings/profile can trigger install prompt
    const handleManualTrigger = () => {
      if (isIOSDevice && isSafari) {
        setIsIOS(true);
        setShowIOSInstructions(true);
        setIsVisible(true);
      } else if (deferredPrompt) {
        setIsVisible(true);
      } else {
        setIsVisible(true);
      }
    };
    window.addEventListener("piechat-show-install-prompt", handleManualTrigger);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      window.removeEventListener("piechat-show-install-prompt", handleManualTrigger);
    };
  }, [deferredPrompt]);

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSInstructions(true);
      return;
    }

    if (!deferredPrompt) {
      // If native prompt is unavailable on desktop/android (already installed or unsupported)
      return;
    }

    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;

      if (choiceResult.outcome === "accepted") {
        localStorage.setItem("piechat_pwa_installed", "true");
        setInstalled(true);
        setIsVisible(false);
      } else {
        // User dismissed the native dialog
        sessionStorage.setItem("piechat_install_dismissed", "true");
        setIsVisible(false);
      }
    } catch (err) {
      console.error("Installation prompt error:", err);
    } finally {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    sessionStorage.setItem("piechat_install_dismissed", "true");
    setIsVisible(false);
    setShowIOSInstructions(false);
  };

  if (installed || !isVisible) {
    return null;
  }

  return (
    <aside
      role="dialog"
      aria-labelledby="pwa-install-title"
      aria-describedby="pwa-install-desc"
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:bottom-6 z-50 max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-5 duration-300"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-white shadow-md">
          <Smartphone size={24} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <h3 id="pwa-install-title" className="font-semibold text-sm text-[var(--foreground)]">
              Install PieChat
            </h3>
            <button
              onClick={handleDismiss}
              className="text-[var(--muted)] hover:text-[var(--foreground)] p-1 rounded-lg transition-colors"
              aria-label="Close installation prompt"
            >
              <X size={16} />
            </button>
          </div>

          <p id="pwa-install-desc" className="mt-1 text-xs text-[var(--muted)] leading-relaxed">
            {isIOS && showIOSInstructions
              ? "To install PieChat on iOS: tap the Share button below, then select 'Add to Home Screen'."
              : "Get fast access, seamless voice calling, and a full standalone app experience."}
          </p>

          {isIOS && showIOSInstructions && (
            <div className="mt-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-2.5 text-xs text-[var(--foreground)] flex items-center gap-2">
              <Share2 size={16} className="text-[var(--primary)] shrink-0" />
              <span>Tap <strong>Share</strong> ⎙ then <strong>Add to Home Screen</strong></span>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            {!showIOSInstructions && (
              <button
                id="pwa-install-button"
                onClick={handleInstallClick}
                className="flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3.5 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-95 transition-opacity"
              >
                <Download size={14} />
                <span>{isIOS ? "How to Install" : "Install App"}</span>
              </button>
            )}

            <button
              onClick={handleDismiss}
              className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-1.5 text-xs font-medium text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
