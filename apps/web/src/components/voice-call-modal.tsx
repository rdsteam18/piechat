"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Socket } from "socket.io-client";
import { supabase } from "@/lib/supabase";
import { getSocket } from "@/lib/socket";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Phone,
  PhoneOff,
  Volume2,
  VolumeX,
  AlertCircle,
  Volume2 as SpeakerIcon,
  Maximize2,
  Minimize2,
  SwitchCamera,
} from "lucide-react";

export type CallStatus =
  | "idle"
  | "calling"
  | "ringing"
  | "incoming"
  | "connecting"
  | "connected"
  | "rejected"
  | "busy"
  | "cancelled"
  | "missed"
  | "failed"
  | "ended";

export interface VoiceCallModalProps {
  currentUserId: string;
  currentUserProfile: {
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  conversationId: string;
  recipient: {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  isInitiator: boolean;
  callType?: "audio" | "video";
  incomingCallData?: {
    callId: string;
    callerId: string;
    callerName: string;
    type?: "audio" | "video";
  } | null;
  onClose: () => void;
}

// ── Default ICE servers (STUN fallback) ──────────────────────────────────────
function getDefaultIceServers(): RTCConfiguration {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ICE_SERVERS) {
    try {
      const parsed = JSON.parse(process.env.NEXT_PUBLIC_ICE_SERVERS);
      if (Array.isArray(parsed)) return { iceServers: parsed };
    } catch {
      /* fall through */
    }
  }
  return {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" },
    ],
  };
}

// ── Procedural ringtone generator ───────────────────────────────────────────
function playProceduralRingtone(type: "outgoing" | "incoming") {
  try {
    if (typeof window === "undefined") return null;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;

    const ctx = new Ctx();
    let alive = true;

    const beep = () => {
      if (!alive || ctx.state === "closed") return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});

      if (type === "outgoing") {
        const o1 = ctx.createOscillator(),
          o2 = ctx.createOscillator();
        const g = ctx.createGain();
        g.gain.value = 0.05;
        o1.type = "sine";
        o1.frequency.value = 440;
        o2.type = "sine";
        o2.frequency.value = 480;
        o1.connect(g);
        o2.connect(g);
        g.connect(ctx.destination);
        o1.start();
        o2.start();
        setTimeout(() => {
          if (!alive) return;
          try {
            o1.stop();
            o2.stop();
            o1.disconnect();
            o2.disconnect();
            g.disconnect();
          } catch {}
        }, 1200);
      } else {
        const o = ctx.createOscillator(),
          g = ctx.createGain();
        g.gain.value = 0.08;
        o.type = "sine";
        o.frequency.value = 853;
        o.connect(g);
        g.connect(ctx.destination);
        o.start();
        setTimeout(() => {
          if (!alive) return;
          try {
            o.stop();
            o.disconnect();
            g.disconnect();
          } catch {}
        }, 400);
      }
    };

    beep();
    const interval = setInterval(beep, type === "outgoing" ? 3000 : 2000);

    return () => {
      alive = false;
      clearInterval(interval);
      try {
        ctx.close();
      } catch {}
    };
  } catch {
    return null;
  }
}

export default function CallModal({
  currentUserId,
  currentUserProfile,
  conversationId,
  recipient,
  isInitiator,
  callType: initialCallType = "audio",
  incomingCallData,
  onClose,
}: VoiceCallModalProps) {
  // Determine call type from incomingCallData if callee, or initialCallType if caller
  const callType = incomingCallData?.type || initialCallType || "audio";

  const [callStatus, setCallStatus] = useState<CallStatus>(
    isInitiator ? "calling" : "incoming"
  );
  const [callId, setCallId] = useState<string>(incomingCallData?.callId ?? "");
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [duration, setDuration] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [remoteHasVideo, setRemoteHasVideo] = useState(callType === "video");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const ringingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const callStartRef = useRef<number | null>(null);
  const iceCandQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const activeCallIdRef = useRef<string>(incomingCallData?.callId ?? "");
  const iceConfigRef = useRef<RTCConfiguration>(getDefaultIceServers());

  // Detect camera devices
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          const videoDevs = devices.filter((d) => d.kind === "videoinput");
          setHasMultipleCameras(videoDevs.length > 1);
        })
        .catch(() => {});
    }
  }, []);

  // Listen to fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Prevent accidental ESC hangup
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  // ── Unified Cleanup ────────────────────────────────────────────────────────
  const teardown = useCallback(() => {
    iceCandQueueRef.current = [];

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (ringingTimerRef.current) {
      clearTimeout(ringingTimerRef.current);
      ringingTimerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
  }, []);

  // ── Drain ICE Candidate Queue ──────────────────────────────────────────────
  const drainIce = useCallback(async (pc: RTCPeerConnection) => {
    while (iceCandQueueRef.current.length > 0) {
      const c = iceCandQueueRef.current.shift()!;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        /* ignore late or duplicate candidates */
      }
    }
  }, []);

  // ── End Call (Terminal state handler) ──────────────────────────────────────
  const endCall = useCallback(
    async (reason: string = "completed") => {
      const cid = activeCallIdRef.current;
      if (cid && socketRef.current?.connected) {
        socketRef.current.emit("call:end", { callId: cid, reason });
      }
      teardown();
      setCallStatus(reason as CallStatus);
      setTimeout(onClose, 1200);
    },
    [teardown, onClose]
  );

  // ── Create RTCPeerConnection ───────────────────────────────────────────────
  const createPeerConnection = useCallback(
    (cid: string) => {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }

      const pc = new RTCPeerConnection(iceConfigRef.current);
      pcRef.current = pc;

      pc.ontrack = ({ streams, track }) => {
        if (track.kind === "video") {
          setRemoteHasVideo(true);
        }

        if (streams[0]) {
          if (callType === "video" && remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = streams[0];
            remoteVideoRef.current
              .play()
              .then(() => setAutoplayBlocked(false))
              .catch(() => setAutoplayBlocked(true));
          } else if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = streams[0];
            remoteAudioRef.current
              .play()
              .then(() => setAutoplayBlocked(false))
              .catch(() => setAutoplayBlocked(true));
          }
        }
      };

      pc.onicecandidate = ({ candidate }) => {
        if (candidate && socketRef.current?.connected) {
          socketRef.current.emit("call:signal", {
            callId: cid,
            kind: "ice",
            candidate: candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setCallStatus("connected");
          if (!callStartRef.current) {
            callStartRef.current = Date.now();
            timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
          }
        } else if (pc.connectionState === "failed") {
          endCall("failed_network");
        }
      };

      return pc;
    },
    [callType, endCall]
  );

  // ── Acquire Local Media ───────────────────────────────────────────────────
  const acquireLocalMedia = useCallback(
    async (pc: RTCPeerConnection): Promise<MediaStream> => {
      const constraints: MediaStreamConstraints =
        callType === "video"
          ? {
              audio: true,
              video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: facingMode,
              },
            }
          : {
              audio: true,
              video: false,
            };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      if (callType === "video" && localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }

      return stream;
    },
    [callType, facingMode]
  );

  // ── Ringtone ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let stop: (() => void) | null = null;
    if (callStatus === "calling" || callStatus === "ringing") {
      stop = playProceduralRingtone("outgoing");
    } else if (callStatus === "incoming") {
      stop = playProceduralRingtone("incoming");
    }
    return () => {
      stop?.();
    };
  }, [callStatus]);

  // ── Socket setup + signaling flow ──────────────────────────────────────────
  useEffect(() => {
    const backendUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
    let isMounted = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!isMounted) return;
      if (!session?.access_token) {
        setErrorMessage("Not authenticated");
        setCallStatus("failed");
        return;
      }

      // Prefetch dynamic ICE servers (STUN + TURN) asynchronously
      fetch(`${backendUrl}/api/calls/ice-config`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.iceServers && Array.isArray(data.iceServers)) {
            iceConfigRef.current = { iceServers: data.iceServers };
          }
        })
        .catch(() => {
          /* keep default STUN */
        });

      // Obtain persistent singleton socket
      const socket = getSocket(session.access_token);
      if (!socket) {
        setErrorMessage("Could not connect to signaling server");
        setCallStatus("failed");
        return;
      }
      socketRef.current = socket;

      // ── Incoming signal handler (SDP offer/answer, ICE) ─────────────────
      const onSignal = async (payload: {
        callId: string;
        kind: string;
        sdp?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit;
      }) => {
        const pc = pcRef.current;
        if (!pc || payload.callId !== activeCallIdRef.current) return;

        switch (payload.kind) {
          case "offer":
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp!));
            await drainIce(pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit("call:signal", {
              callId: payload.callId,
              kind: "answer",
              sdp: answer,
            });
            break;

          case "answer":
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp!));
            await drainIce(pc);
            break;

          case "ice":
          case "ice-restart-offer":
            if (pc.remoteDescription) {
              try {
                await pc.addIceCandidate(
                  new RTCIceCandidate(payload.candidate as RTCIceCandidateInit)
                );
              } catch {
                /* ignore duplicate or late candidates */
              }
            } else {
              iceCandQueueRef.current.push(payload.candidate as RTCIceCandidateInit);
            }
            break;
        }
      };

      // ── Call accepted by callee → create WebRTC offer ───────────────────
      const onAccepted = async ({ callId: cid }: { callId: string }) => {
        if (cid !== activeCallIdRef.current) return;
        setCallStatus("connecting");

        if (ringingTimerRef.current) {
          clearTimeout(ringingTimerRef.current);
          ringingTimerRef.current = null;
        }

        try {
          const pc = createPeerConnection(cid);
          await acquireLocalMedia(pc);

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("call:signal", { callId: cid, kind: "offer", sdp: offer });
        } catch (err: unknown) {
          const name = err instanceof Error ? err.name : "";
          setErrorMessage(
            name === "NotAllowedError"
              ? `${callType === "video" ? "Camera or microphone" : "Microphone"} access denied.`
              : `Could not access media devices.`
          );
          endCall("failed_media");
        }
      };

      // ── Call ended by server or peer ─────────────────────────────────────
      const onEnded = ({
        callId: cid,
        reason,
      }: {
        callId: string;
        reason?: string;
      }) => {
        if (cid !== activeCallIdRef.current && cid !== "") return;
        teardown();
        setCallStatus((reason as CallStatus) ?? "ended");
        setTimeout(onClose, 1500);
      };

      // ── Answered in another tab ──────────────────────────────────────────
      const onAnsweredElsewhere = ({ callId: cid }: { callId: string }) => {
        if (cid !== activeCallIdRef.current) return;
        teardown();
        onClose();
      };

      // Register listeners
      socket.off("call:signal", onSignal);
      socket.on("call:signal", onSignal);

      socket.off("call:accepted", onAccepted);
      socket.on("call:accepted", onAccepted);

      socket.off("call:ended", onEnded);
      socket.on("call:ended", onEnded);

      socket.off("call:answered-elsewhere", onAnsweredElsewhere);
      socket.on("call:answered-elsewhere", onAnsweredElsewhere);

      // ── Immediate initiate for caller ──────────────────────────────────
      const emitInitiate = () => {
        socket.emit(
          "call:initiate",
          {
            conversationId,
            type: callType,
            clientRequestId: crypto.randomUUID(),
          },
          (res: {
            ok: boolean;
            callId?: string;
            code?: string;
            message?: string;
          }) => {
            if (!res.ok) {
              const msgs: Record<string, string> = {
                BUSY: "User is busy on another call.",
                OFFLINE: "User is not online right now.",
                NOT_MEMBER: "Not authorized for this conversation.",
                RATE_LIMITED: "Too many call attempts. Try again in a moment.",
              };
              setErrorMessage(
                msgs[res.code ?? ""] ?? (res.message ?? "Failed to initiate call.")
              );
              setCallStatus("failed");
              setTimeout(onClose, 2500);
              return;
            }

            activeCallIdRef.current = res.callId!;
            setCallId(res.callId!);
            setCallStatus("ringing");

            // Local ringing timeout fallback
            ringingTimerRef.current = setTimeout(() => {
              setErrorMessage("No answer.");
              endCall("missed");
            }, 42_000);
          }
        );
      };

      if (isInitiator) {
        if (socket.connected) {
          emitInitiate();
        } else {
          socket.once("connect", emitInitiate);
        }
      } else if (incomingCallData) {
        activeCallIdRef.current = incomingCallData.callId;
      }
    });

    return () => {
      isMounted = false;
      teardown();
      if (socketRef.current) {
        socketRef.current.off("call:signal");
        socketRef.current.off("call:accepted");
        socketRef.current.off("call:ended");
        socketRef.current.off("call:answered-elsewhere");
        socketRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Callee Accepts Call ───────────────────────────────────────────────────
  const handleAccept = async () => {
    if (!incomingCallData || !socketRef.current) return;
    const cid = incomingCallData.callId;
    activeCallIdRef.current = cid;

    try {
      const pc = createPeerConnection(cid);
      await acquireLocalMedia(pc);

      socketRef.current.emit(
        "call:accept",
        { callId: cid },
        (res: { ok: boolean }) => {
          if (!res?.ok) {
            setErrorMessage("Could not accept call.");
            endCall("failed");
          } else {
            setCallStatus("connecting");
          }
        }
      );
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      setErrorMessage(
        name === "NotAllowedError"
          ? `${callType === "video" ? "Camera or microphone" : "Microphone"} access denied.`
          : "Failed to establish call media."
      );
      endCall("failed_media");
    }
  };

  // ── Callee Declines Call ──────────────────────────────────────────────────
  const handleDecline = () => {
    if (incomingCallData && socketRef.current?.connected) {
      socketRef.current.emit("call:decline", { callId: incomingCallData.callId });
    }
    teardown();
    setCallStatus("rejected");
    setTimeout(onClose, 800);
  };

  // ── Caller Cancels Call ───────────────────────────────────────────────────
  const handleCancel = () => {
    const cid = activeCallIdRef.current;
    if (cid && socketRef.current?.connected) {
      socketRef.current.emit("call:cancel", { callId: cid });
    }
    teardown();
    setCallStatus("cancelled");
    setTimeout(onClose, 800);
  };

  // ── Microphone Mute/Unmute ─────────────────────────────────────────────────
  const toggleMute = () => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  };

  // ── Camera On/Off ──────────────────────────────────────────────────────────
  const toggleCamera = () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsCameraOff(!videoTrack.enabled);
    }
  };

  // ── Switch Front/Rear Camera (Mobile) ───────────────────────────────────────
  const flipCamera = async () => {
    if (callType !== "video" || !localStreamRef.current || !pcRef.current) return;
    const nextMode = facingMode === "user" ? "environment" : "user";
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: { exact: nextMode },
        },
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (newVideoTrack) {
        const senders = pcRef.current.getSenders();
        const videoSender = senders.find((s) => s.track?.kind === "video");
        if (videoSender) {
          await videoSender.replaceTrack(newVideoTrack);
        }
        const oldTrack = localStreamRef.current.getVideoTracks()[0];
        if (oldTrack) {
          oldTrack.stop();
          localStreamRef.current.removeTrack(oldTrack);
        }
        localStreamRef.current.addTrack(newVideoTrack);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }
        setFacingMode(nextMode);
      }
    } catch (err) {
      console.warn("Could not switch camera:", err);
    }
  };

  // ── Fullscreen Toggle ──────────────────────────────────────────────────────
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(() => {});
    }
  };

  // ── Speaker Toggle ─────────────────────────────────────────────────────────
  const toggleSpeaker = () => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !remoteAudioRef.current.muted;
      setIsSpeakerOn(!remoteAudioRef.current.muted);
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = !remoteVideoRef.current.muted;
      setIsSpeakerOn(!remoteVideoRef.current.muted);
    }
  };

  // ── Autoplay Bypass ────────────────────────────────────────────────────────
  const enableMediaPlayback = () => {
    if (callType === "video" && remoteVideoRef.current) {
      remoteVideoRef.current
        .play()
        .then(() => setAutoplayBlocked(false))
        .catch(() => {});
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current
        .play()
        .then(() => setAutoplayBlocked(false))
        .catch(() => {});
    }
  };

  // ── Duration Formatter ─────────────────────────────────────────────────────
  const formatDuration = (s: number) => {
    const h = Math.floor(s / 3600),
      m = Math.floor((s % 3600) / 60),
      sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const displayName =
    recipient?.display_name ||
    recipient?.username ||
    incomingCallData?.callerName ||
    "PieChat Contact";

  const isCallActive = callStatus === "connected" || callStatus === "connecting";

  // ───────────────────────────────────────────────────────────────────────────
  // RENDER: VIDEO CALL (ACTIVE OR CONNECTING)
  // ───────────────────────────────────────────────────────────────────────────
  if (callType === "video" && (isCallActive || callStatus === "ringing" || callStatus === "calling")) {
    return (
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Video Call"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 select-none animate-in fade-in duration-200"
        onClick={(e) => {
          // Accidental hangup prevention: never close modal on backdrop click
          e.stopPropagation();
        }}
      >
        {/* Hidden audio element for auxiliary playback */}
        <audio ref={remoteAudioRef} autoPlay playsInline />

        <div
          className="relative w-full max-w-5xl h-[88vh] sm:h-[84vh] rounded-3xl overflow-hidden border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Main Remote Video or Avatar Fallback */}
          <div className="relative flex-1 w-full h-full bg-zinc-950 flex items-center justify-center overflow-hidden">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                remoteHasVideo && isCallActive ? "opacity-100" : "opacity-0"
              }`}
            />

            {/* Remote Fallback / Calling Screen */}
            {(!remoteHasVideo || !isCallActive) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-zinc-900 to-zinc-950 p-6">
                <div className="relative mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-600 to-purple-500 p-1 shadow-2xl ring-4 ring-indigo-500/20">
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-zinc-900 font-bold text-3xl text-indigo-400">
                    {displayName.slice(0, 2).toUpperCase()}
                  </div>
                </div>

                <h3 className="text-2xl font-bold tracking-tight text-white">{displayName}</h3>

                <div className="mt-2 flex items-center gap-2">
                  {callStatus === "connecting" ? (
                    <span className="text-sm text-indigo-400 animate-pulse font-medium">
                      Establishing encrypted video stream…
                    </span>
                  ) : callStatus === "ringing" || callStatus === "calling" ? (
                    <span className="text-sm text-zinc-400 animate-pulse">
                      Calling {displayName}…
                    </span>
                  ) : (
                    <span className="text-sm text-zinc-400 capitalize">
                      {errorMessage || callStatus}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Top Bar Floating Status Card */}
            <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-30 pointer-events-none">
              <div className="pointer-events-auto flex items-center gap-3 backdrop-blur-md bg-black/50 px-4 py-2 rounded-full border border-white/10 text-white shadow-lg">
                <div className="flex items-center gap-2">
                  <div
                    className={`h-2.5 w-2.5 rounded-full ${
                      callStatus === "connected"
                        ? "bg-emerald-500 animate-pulse"
                        : "bg-amber-400"
                    }`}
                  />
                  <span className="font-semibold text-sm">{displayName}</span>
                </div>
                <span className="text-white/40">|</span>
                <span className="font-mono text-xs font-medium text-emerald-400">
                  {callStatus === "connected"
                    ? formatDuration(duration)
                    : callStatus === "connecting"
                    ? "Connecting..."
                    : "Ringing..."}
                </span>
              </div>

              <div className="pointer-events-auto flex items-center gap-2">
                <button
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                  className="flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-md bg-black/50 border border-white/10 text-white hover:bg-black/70 transition-colors shadow-lg cursor-pointer"
                >
                  {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
              </div>
            </div>

            {/* Floating Local PiP Video Preview */}
            <div
              className={`absolute bottom-24 right-4 sm:right-6 w-32 h-44 sm:w-44 sm:h-60 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl z-20 bg-zinc-900 transition-all ${
                isCameraOff ? "flex items-center justify-center" : ""
              }`}
            >
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover scale-x-[-1] ${
                  isCameraOff ? "hidden" : "block"
                }`}
              />
              {isCameraOff && (
                <div className="flex flex-col items-center justify-center text-zinc-400 p-2 text-center">
                  <VideoOff size={24} className="mb-1 text-zinc-500" />
                  <span className="text-[10px] font-medium">Camera Off</span>
                </div>
              )}
              <div className="absolute top-2 left-2 backdrop-blur-md bg-black/60 px-2 py-0.5 rounded text-[10px] font-semibold text-white/90">
                You {isMuted ? "(Muted)" : ""}
              </div>
            </div>

            {/* Autoplay blocked banner */}
            {autoplayBlocked && (
              <div className="absolute bottom-24 left-4 sm:left-6 z-30">
                <button
                  onClick={enableMediaPlayback}
                  className="flex items-center gap-2 rounded-xl bg-amber-500/90 text-black px-4 py-2.5 text-xs font-semibold shadow-xl hover:bg-amber-400 transition-colors cursor-pointer"
                >
                  <SpeakerIcon size={16} />
                  <span>Tap to enable video & audio</span>
                </button>
              </div>
            )}

            {/* Error Message */}
            {errorMessage && (
              <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 text-xs text-rose-300 bg-rose-950/80 border border-rose-500/50 py-2 px-4 rounded-xl shadow-xl">
                <AlertCircle size={15} />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>

          {/* Bottom Floating Controls Bar */}
          <div className="relative z-30 flex items-center justify-center p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
            <div className="flex items-center gap-4 backdrop-blur-xl bg-zinc-900/80 border border-zinc-700/60 px-6 py-3.5 rounded-full shadow-2xl">
              {/* Mic toggle */}
              <button
                onClick={toggleMute}
                aria-label={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                className={`flex h-12 w-12 items-center justify-center rounded-full border transition-all cursor-pointer ${
                  isMuted
                    ? "bg-rose-600/20 border-rose-500 text-rose-400"
                    : "bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700"
                }`}
              >
                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>

              {/* Camera toggle */}
              <button
                onClick={toggleCamera}
                aria-label={isCameraOff ? "Turn Camera On" : "Turn Camera Off"}
                className={`flex h-12 w-12 items-center justify-center rounded-full border transition-all cursor-pointer ${
                  isCameraOff
                    ? "bg-rose-600/20 border-rose-500 text-rose-400"
                    : "bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700"
                }`}
              >
                {isCameraOff ? <VideoOff size={20} /> : <Video size={20} />}
              </button>

              {/* Mobile camera flip if multiple cameras exist */}
              {hasMultipleCameras && (
                <button
                  onClick={flipCamera}
                  aria-label="Switch Camera"
                  className="flex h-12 w-12 items-center justify-center rounded-full border bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700 transition-all cursor-pointer"
                  title="Switch Front/Back Camera"
                >
                  <SwitchCamera size={20} />
                </button>
              )}

              {/* Speaker toggle */}
              <button
                onClick={toggleSpeaker}
                aria-label={isSpeakerOn ? "Mute Speaker" : "Unmute Speaker"}
                className="flex h-12 w-12 items-center justify-center rounded-full border bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700 transition-all cursor-pointer"
              >
                {isSpeakerOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
              </button>

              {/* End Call / Cancel */}
              {isCallActive ? (
                <button
                  onClick={() => endCall("completed")}
                  aria-label="End Video Call"
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-xl hover:bg-rose-700 transition-transform active:scale-95 cursor-pointer ml-2"
                >
                  <PhoneOff size={24} />
                </button>
              ) : (
                <button
                  onClick={handleCancel}
                  aria-label="Cancel Video Call"
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-xl hover:bg-rose-700 transition-transform active:scale-95 cursor-pointer ml-2"
                >
                  <PhoneOff size={24} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // RENDER: VOICE CALL OR INCOMING VIDEO CALL CARD
  // ───────────────────────────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={callType === "video" ? "Video Call" : "Voice Call"}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200 select-none"
      onClick={(e) => {
        // Prevent background clicks or bubbling from accidentally ending the call
        e.stopPropagation();
      }}
    >
      {/* Hidden audio element for remote voice stream */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div
        className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-950 p-6 text-center text-white shadow-2xl"
        onClick={(e) => {
          // Explicitly isolate call modal UI clicks from bubbling
          e.stopPropagation();
        }}
      >
        {/* Avatar */}
        <div
          className={`mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full p-1 shadow-lg ring-4 ${
            callType === "video"
              ? "bg-gradient-to-tr from-indigo-600 to-purple-500 ring-indigo-500/20"
              : "bg-gradient-to-tr from-emerald-600 to-teal-400 ring-emerald-500/20"
          }`}
        >
          <div
            className={`flex h-full w-full items-center justify-center rounded-full bg-zinc-900 font-bold text-2xl ${
              callType === "video" ? "text-indigo-400" : "text-emerald-400"
            }`}
          >
            {displayName.slice(0, 2).toUpperCase()}
          </div>
        </div>

        <h3 className="text-xl font-bold tracking-tight">{displayName}</h3>

        {/* Status */}
        <div className="mt-1 flex items-center justify-center gap-2">
          {isCallActive ? (
            <span
              className={`font-mono text-sm font-medium ${
                callType === "video" ? "text-indigo-400" : "text-emerald-400"
              }`}
            >
              {callStatus === "connecting"
                ? "Connecting..."
                : formatDuration(duration)}
            </span>
          ) : callStatus === "ringing" || callStatus === "calling" ? (
            <span className="text-sm text-zinc-400 animate-pulse">
              {callType === "video" ? "Video Calling…" : "Ringing…"}
            </span>
          ) : callStatus === "incoming" ? (
            <span
              className={`text-sm animate-pulse font-medium ${
                callType === "video" ? "text-indigo-400" : "text-emerald-400"
              }`}
            >
              {callType === "video" ? "Incoming video call…" : "Incoming voice call…"}
            </span>
          ) : (
            <span className="text-sm text-zinc-400 capitalize">
              {errorMessage || callStatus}
            </span>
          )}
        </div>

        {/* Autoplay blocked */}
        {autoplayBlocked && (
          <div className="mt-3">
            <button
              onClick={enableMediaPlayback}
              className="flex items-center justify-center gap-1.5 w-full rounded-xl bg-amber-500/20 border border-amber-500/50 text-amber-300 py-2 px-3 text-xs font-medium hover:bg-amber-500/30 transition-colors cursor-pointer"
            >
              <SpeakerIcon size={14} />
              <span>Tap to enable incoming audio</span>
            </button>
          </div>
        )}

        {/* Error */}
        {errorMessage && !autoplayBlocked && (
          <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/40 py-1.5 px-3 rounded-lg">
            <AlertCircle size={14} className="shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Controls: Only explicit buttons change call state */}
        <div className="mt-8 flex items-center justify-center gap-5">
          {callStatus === "incoming" ? (
            <>
              <button
                onClick={handleDecline}
                aria-label="Decline Call"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg hover:bg-rose-700 transition-transform active:scale-95 cursor-pointer"
              >
                <PhoneOff size={24} />
              </button>
              <button
                onClick={handleAccept}
                aria-label={`Accept ${callType === "video" ? "Video" : "Voice"} Call`}
                className={`flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-95 animate-bounce cursor-pointer ${
                  callType === "video"
                    ? "bg-indigo-600 hover:bg-indigo-700"
                    : "bg-emerald-500 hover:bg-emerald-600"
                }`}
              >
                {callType === "video" ? <Video size={24} /> : <Phone size={24} />}
              </button>
            </>
          ) : isCallActive ? (
            <>
              <button
                onClick={toggleMute}
                aria-label={isMuted ? "Unmute" : "Mute"}
                className={`flex h-12 w-12 items-center justify-center rounded-full border transition-all cursor-pointer ${
                  isMuted
                    ? "bg-rose-600/20 border-rose-500 text-rose-400"
                    : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              <button
                onClick={() => endCall("completed")}
                aria-label="End Call"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg hover:bg-rose-700 transition-transform active:scale-95 cursor-pointer"
              >
                <PhoneOff size={24} />
              </button>
              <button
                onClick={toggleSpeaker}
                aria-label={isSpeakerOn ? "Mute Speaker" : "Unmute Speaker"}
                className="flex h-12 w-12 items-center justify-center rounded-full border bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-all cursor-pointer"
              >
                {isSpeakerOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
              </button>
            </>
          ) : (
            <button
              onClick={handleCancel}
              aria-label="Cancel Call"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg hover:bg-rose-700 transition-transform active:scale-95 cursor-pointer"
            >
              <PhoneOff size={24} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export { CallModal, CallModal as VoiceCallModal };
