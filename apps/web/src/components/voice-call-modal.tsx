"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Volume2,
  VolumeX,
  AlertCircle,
  Volume2 as SpeakerIcon,
} from "lucide-react";

export type CallStatus =
  | "idle"
  | "calling"
  | "ringing"
  | "incoming"
  | "accepted"
  | "rejected"
  | "busy"
  | "cancelled"
  | "missed"
  | "failed"
  | "ended";

interface VoiceCallModalProps {
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
  incomingOfferData?: {
    callId: string;
    callerId: string;
    callerName: string;
    sdp: RTCSessionDescriptionInit;
  } | null;
  onClose: () => void;
}

// Configurable STUN / TURN servers via environment variable
function getIceServers(): RTCConfiguration {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ICE_SERVERS) {
    try {
      const parsed = JSON.parse(process.env.NEXT_PUBLIC_ICE_SERVERS);
      if (Array.isArray(parsed)) {
        return { iceServers: parsed };
      }
    } catch {
      // Fallback to default STUN
    }
  }

  return {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" },
    ],
  };
}

// Procedural audio ringtone player using standard Web Audio API
function playProceduralRingtone(type: "outgoing" | "incoming") {
  try {
    if (typeof window === "undefined") return null;
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return null;

    const ctx = new AudioContextClass();
    let isPlaying = true;

    const triggerBeep = () => {
      if (!isPlaying || ctx.state === "closed") return;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      if (type === "outgoing") {
        // Dual-tone: 440Hz + 480Hz pulses
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.frequency.value = 440;
        osc2.frequency.value = 480;
        gain.gain.value = 0.05;

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start();
        osc2.start();

        setTimeout(() => {
          try {
            osc1.stop();
            osc2.stop();
          } catch {}
        }, 1200);
      } else {
        // Incoming chirp: 800Hz rising to 1000Hz
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(
          1050,
          ctx.currentTime + 0.35
        );
        gain.gain.value = 0.08;

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        setTimeout(() => {
          try {
            osc.stop();
          } catch {}
        }, 400);
      }
    };

    triggerBeep();
    const interval = setInterval(
      triggerBeep,
      type === "outgoing" ? 3500 : 1800
    );

    return () => {
      isPlaying = false;
      clearInterval(interval);
      try {
        ctx.close().catch(() => {});
      } catch {}
    };
  } catch {
    return null;
  }
}

export default function VoiceCallModal({
  currentUserId,
  currentUserProfile,
  conversationId,
  recipient,
  isInitiator,
  incomingOfferData,
  onClose,
}: VoiceCallModalProps) {
  const [callStatus, setCallStatus] = useState<CallStatus>(
    isInitiator ? "calling" : "incoming"
  );
  const [callId, setCallId] = useState<string>(
    incomingOfferData?.callId || ""
  );
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [duration, setDuration] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [audioAutoplayBlocked, setAudioAutoplayBlocked] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const ringingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const iceCandidatesQueueRef = useRef<RTCIceCandidateInit[]>([]);

  // Drain buffered ICE candidates once remote description is set
  const drainIceCandidates = useCallback(async (pc: RTCPeerConnection) => {
    while (iceCandidatesQueueRef.current.length > 0) {
      const cand = iceCandidatesQueueRef.current.shift();
      if (cand) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (err) {
          console.warn("Error adding queued ICE candidate:", err);
        }
      }
    }
  }, []);

  // Play ringing sound on outgoing/incoming state
  useEffect(() => {
    let stopRingtone: (() => void) | null = null;
    if (callStatus === "calling" || callStatus === "ringing") {
      stopRingtone = playProceduralRingtone("outgoing");
    } else if (callStatus === "incoming") {
      stopRingtone = playProceduralRingtone("incoming");
    }

    return () => {
      if (stopRingtone) stopRingtone();
    };
  }, [callStatus]);

  // Helper to update call log in Supabase
  const updateCallRecord = useCallback(
    async (
      idToUpdate: string,
      updates: {
        status: string;
        started_at?: string;
        ended_at?: string;
        duration?: number;
      }
    ) => {
      if (!idToUpdate) return;
      try {
        await supabase
          .from("calls")
          .update(updates)
          .eq("id", idToUpdate);
      } catch (err) {
        console.warn("Failed to update call log in Supabase:", err);
      }
    },
    []
  );

  // Teardown everything
  const cleanupMediaAndPeer = useCallback(() => {
    iceCandidatesQueueRef.current = [];
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
  }, []);

  const handleEndCall = useCallback(
    async (reason: CallStatus = "ended") => {
      const activeCallId = callId;
      const finalDuration = duration;

      // Broadcast termination to peer
      if (channelRef.current && activeCallId) {
        channelRef.current.send({
          type: "broadcast",
          event: "call_signal",
          payload: {
            type:
              reason === "rejected"
                ? "call_reject"
                : reason === "cancelled"
                ? "call_cancel"
                : "call_end",
            callId: activeCallId,
            senderId: currentUserId,
          },
        });
      }

      cleanupMediaAndPeer();
      setCallStatus(reason);

      if (activeCallId) {
        const now = new Date().toISOString();
        if (reason === "accepted" || reason === "ended") {
          await updateCallRecord(activeCallId, {
            status: "ended",
            ended_at: now,
            duration: finalDuration,
          });
        } else {
          await updateCallRecord(activeCallId, {
            status: reason,
            ended_at: now,
            duration: 0,
          });
        }
      }

      // Automatically close modal after brief delay
      setTimeout(() => {
        onClose();
      }, 1500);
    },
    [callId, currentUserId, duration, cleanupMediaAndPeer, updateCallRecord, onClose]
  );

  // Initialize WebRTC Peer Connection
  const createPeerConnection = useCallback(
    (targetCallId: string) => {
      const pc = new RTCPeerConnection(getIceServers());
      peerConnectionRef.current = pc;

      // Handle remote audio stream
      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = event.streams[0];
            remoteAudioRef.current.play().catch(() => {
              setAudioAutoplayBlocked(true);
            });
          }
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && channelRef.current) {
          channelRef.current.send({
            type: "broadcast",
            event: "call_signal",
            payload: {
              type: "call_candidate",
              callId: targetCallId,
              senderId: currentUserId,
              candidate: event.candidate,
            },
          });
        }
      };

      // Monitor connection state
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setCallStatus("accepted");
          if (!callStartTimeRef.current) {
            callStartTimeRef.current = Date.now();
            timerRef.current = setInterval(() => {
              setDuration((prev) => prev + 1);
            }, 1000);
          }
        } else if (
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed"
        ) {
          setErrorMessage("Call disconnected");
          handleEndCall("failed");
        }
      };

      return pc;
    },
    [currentUserId, handleEndCall]
  );

  // Initiator Start Call Flow
  const startOutgoingCall = useCallback(async () => {
    if (!recipient) {
      setErrorMessage("Recipient could not be found.");
      setCallStatus("failed");
      return;
    }

    try {
      // 1. Audio-only media request (never video)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      localStreamRef.current = stream;

      // 2. Persist call record in Supabase (with safe fallback so call is never aborted)
      let newCallId = crypto.randomUUID();
      try {
        const { data: callData, error: callError } = await supabase
          .from("calls")
          .insert({
            conversation_id: conversationId,
            caller_id: currentUserId,
            recipient_id: recipient.id,
            status: "ringing",
          })
          .select("id")
          .single();

        if (callData?.id) {
          newCallId = callData.id;
        } else if (callError) {
          console.warn("Call logging warning (continuing call p2p):", callError.message);
        }
      } catch (dbErr) {
        console.warn("DB logging fallback:", dbErr);
      }

      setCallId(newCallId);

      // 3. Create WebRTC Peer Connection
      const pc = createPeerConnection(newCallId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 4. Create SDP Offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 5. Send Offer over Supabase Realtime broadcast channel
      const offerPayload = {
        type: "call_offer",
        callId: newCallId,
        conversationId,
        senderId: currentUserId,
        callerId: currentUserId,
        callerName:
          currentUserProfile?.display_name ||
          currentUserProfile?.username ||
          "PieChat User",
        sdp: offer,
      };

      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "call_signal",
          payload: offerPayload,
        });
      }

      // Also send directly to recipient's notification channel
      const sendDirectNotification = () => {
        const recipientChannel = supabase.channel(`user-calls-${recipient.id}`, {
          config: { broadcast: { self: false } },
        });
        recipientChannel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            recipientChannel.send({
              type: "broadcast",
              event: "incoming_call",
              payload: offerPayload,
            });
          }
        });
      };
      sendDirectNotification();
      // Retry once after 1.5s in case recipient just loaded page
      setTimeout(sendDirectNotification, 1500);

      setCallStatus("ringing");

      // 6. Ringing timeout (35 seconds) -> missed call if no response
      ringingTimeoutRef.current = setTimeout(async () => {
        setErrorMessage("No answer");
        await handleEndCall("missed");
      }, 35000);
    } catch (err: unknown) {
      console.error("Microphone or WebRTC initiation error:", err);
      const isPermissionDenied =
        err instanceof Error &&
        (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");

      setErrorMessage(
        isPermissionDenied
          ? "Microphone access was denied. Please allow microphone permissions."
          : "Could not access microphone."
      );
      setCallStatus("failed");
      cleanupMediaAndPeer();
    }
  }, [
    recipient,
    conversationId,
    currentUserId,
    currentUserProfile,
    createPeerConnection,
    handleEndCall,
    cleanupMediaAndPeer,
  ]);

  // Recipient Accept Call Flow
  const handleAcceptCall = async () => {
    if (!incomingOfferData || !incomingOfferData.sdp) return;

    try {
      if (ringingTimeoutRef.current) {
        clearTimeout(ringingTimeoutRef.current);
        ringingTimeoutRef.current = null;
      }

      // 1. Audio-only media request (never video)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      localStreamRef.current = stream;

      const activeCallId = incomingOfferData.callId;
      setCallId(activeCallId);

      // 2. Create WebRTC Peer Connection
      const pc = createPeerConnection(activeCallId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 3. Set Remote SDP (Offer)
      await pc.setRemoteDescription(
        new RTCSessionDescription(incomingOfferData.sdp)
      );

      // Drain any early buffered candidates
      await drainIceCandidates(pc);

      // 4. Create SDP Answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // 5. Broadcast Answer to Caller
      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "call_signal",
          payload: {
            type: "call_answer",
            callId: activeCallId,
            senderId: currentUserId,
            sdp: answer,
          },
        });
      }

      // Also send to caller's direct channel
      const callerDirectChannel = supabase.channel(`user-calls-${incomingOfferData.callerId}`, {
        config: { broadcast: { self: false } },
      });
      callerDirectChannel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          callerDirectChannel.send({
            type: "broadcast",
            event: "call_signal",
            payload: {
              type: "call_answer",
              callId: activeCallId,
              senderId: currentUserId,
              sdp: answer,
            },
          });
        }
      });

      // 6. Update call record in Supabase
      await updateCallRecord(activeCallId, {
        status: "accepted",
        started_at: new Date().toISOString(),
      });

      setCallStatus("accepted");
      callStartTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (err: unknown) {
      console.error("Error accepting call:", err);
      const isPermissionDenied =
        err instanceof Error &&
        (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");

      setErrorMessage(
        isPermissionDenied
          ? "Microphone permission denied. Cannot join call."
          : "Failed to establish call audio."
      );
      await handleEndCall("failed");
    }
  };

  // Toggle Microphone Mute
  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  // Toggle Audio Speaker Playback
  const toggleSpeaker = () => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !remoteAudioRef.current.muted;
      setIsSpeakerOn(!remoteAudioRef.current.muted);
    }
  };

  const handleEnableAudioManual = () => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current
        .play()
        .then(() => setAudioAutoplayBlocked(false))
        .catch(() => {});
    }
  };

  // Channel signaling listener
  useEffect(() => {
    const channel = supabase.channel(`call-signal-${conversationId}`, {
      config: { broadcast: { self: false } },
    });

    channelRef.current = channel;

    channel
      .on("broadcast", { event: "call_signal" }, async (payload) => {
        const signal = payload.payload;
        if (!signal || signal.senderId === currentUserId) return;

        switch (signal.type) {
          case "call_answer":
            if (isInitiator && peerConnectionRef.current && signal.sdp) {
              if (ringingTimeoutRef.current) {
                clearTimeout(ringingTimeoutRef.current);
                ringingTimeoutRef.current = null;
              }
              await peerConnectionRef.current.setRemoteDescription(
                new RTCSessionDescription(signal.sdp)
              );
              await drainIceCandidates(peerConnectionRef.current);
              setCallStatus("accepted");
              if (!callStartTimeRef.current) {
                callStartTimeRef.current = Date.now();
                timerRef.current = setInterval(() => {
                  setDuration((prev) => prev + 1);
                }, 1000);
              }
            }
            break;

          case "call_candidate":
            if (peerConnectionRef.current && signal.candidate) {
              try {
                if (peerConnectionRef.current.remoteDescription) {
                  await peerConnectionRef.current.addIceCandidate(
                    new RTCIceCandidate(signal.candidate)
                  );
                } else {
                  iceCandidatesQueueRef.current.push(signal.candidate);
                }
              } catch (e) {
                console.warn("Failed to add ICE candidate:", e);
              }
            }
            break;

          case "call_reject":
            setErrorMessage("Call declined");
            setCallStatus("rejected");
            cleanupMediaAndPeer();
            setTimeout(onClose, 2000);
            break;

          case "call_busy":
            setErrorMessage("User is busy on another call");
            setCallStatus("busy");
            cleanupMediaAndPeer();
            setTimeout(onClose, 2000);
            break;

          case "call_cancel":
            setErrorMessage("Call cancelled by caller");
            setCallStatus("cancelled");
            cleanupMediaAndPeer();
            setTimeout(onClose, 2000);
            break;

          case "call_end":
            setErrorMessage("Call ended");
            setCallStatus("ended");
            cleanupMediaAndPeer();
            setTimeout(onClose, 1500);
            break;
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && isInitiator) {
          void startOutgoingCall();
        }
      });

    return () => {
      cleanupMediaAndPeer();
      supabase.removeChannel(channel);
    };
  }, [
    conversationId,
    currentUserId,
    isInitiator,
    startOutgoingCall,
    cleanupMediaAndPeer,
    onClose,
  ]);

  // Format Call Duration: mm:ss or hh:mm:ss
  const formatDuration = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, "0")}:${secs
        .toString()
        .padStart(2, "0")}`;
    }
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  const displayName =
    recipient?.display_name ||
    recipient?.username ||
    incomingOfferData?.callerName ||
    "PieChat Contact";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Voice Call"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      {/* Hidden audio element for remote stream */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-950 p-6 text-center text-white shadow-2xl">
        {/* Contact Avatar */}
        <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-600 to-teal-400 p-1 shadow-lg ring-4 ring-emerald-500/20">
          <div className="flex h-full w-full items-center justify-center rounded-full bg-zinc-900 font-bold text-2xl text-emerald-400">
            {displayName.slice(0, 2).toUpperCase()}
          </div>
        </div>

        {/* Contact Name */}
        <h3 className="text-xl font-bold tracking-tight">{displayName}</h3>

        {/* Status / Duration */}
        <div className="mt-1 flex items-center justify-center gap-2">
          {callStatus === "accepted" ? (
            <span className="font-mono text-sm font-medium text-emerald-400">
              {formatDuration(duration)}
            </span>
          ) : callStatus === "calling" || callStatus === "ringing" ? (
            <span className="text-sm text-zinc-400 animate-pulse">
              Ringing...
            </span>
          ) : callStatus === "incoming" ? (
            <span className="text-sm text-emerald-400 animate-pulse font-medium">
              Incoming voice call...
            </span>
          ) : (
            <span className="text-sm text-zinc-400 capitalize">
              {errorMessage || callStatus}
            </span>
          )}
        </div>

        {/* Autoplay blocked interaction prompt */}
        {audioAutoplayBlocked && (
          <div className="mt-3">
            <button
              onClick={handleEnableAudioManual}
              className="flex items-center justify-center gap-1.5 w-full rounded-xl bg-amber-500/20 border border-amber-500/50 text-amber-300 py-2 px-3 text-xs font-medium hover:bg-amber-500/30 transition-colors"
            >
              <SpeakerIcon size={14} />
              <span>Tap here to enable incoming audio</span>
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/40 py-1.5 px-3 rounded-lg">
            <AlertCircle size={14} className="shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Action Controls */}
        <div className="mt-8 flex items-center justify-center gap-5">
          {callStatus === "incoming" ? (
            <>
              {/* Decline Button */}
              <button
                onClick={() => handleEndCall("rejected")}
                aria-label="Decline Call"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg hover:bg-rose-700 transition-transform active:scale-95"
              >
                <PhoneOff size={24} />
              </button>

              {/* Accept Button */}
              <button
                onClick={handleAcceptCall}
                aria-label="Accept Call"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg hover:bg-emerald-600 transition-transform active:scale-95 animate-bounce"
              >
                <Phone size={24} />
              </button>
            </>
          ) : callStatus === "accepted" ? (
            <>
              {/* Mute Button */}
              <button
                onClick={toggleMute}
                aria-label={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                className={`flex h-12 w-12 items-center justify-center rounded-full border transition-all ${
                  isMuted
                    ? "bg-rose-600/20 border-rose-500 text-rose-400"
                    : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>

              {/* End Call Button */}
              <button
                onClick={() => handleEndCall("ended")}
                aria-label="End Call"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg hover:bg-rose-700 transition-transform active:scale-95"
              >
                <PhoneOff size={24} />
              </button>

              {/* Speaker Toggle */}
              <button
                onClick={toggleSpeaker}
                aria-label={isSpeakerOn ? "Mute Speaker" : "Unmute Speaker"}
                className={`flex h-12 w-12 items-center justify-center rounded-full border transition-all ${
                  !isSpeakerOn
                    ? "bg-zinc-800 border-zinc-700 text-zinc-500"
                    : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                {isSpeakerOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
              </button>
            </>
          ) : (
            // Calling / Ringing / Ended State: Cancel / End Button
            <button
              onClick={() =>
                handleEndCall(
                  callStatus === "ringing" || callStatus === "calling"
                    ? "cancelled"
                    : "ended"
                )
              }
              aria-label="End Call"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg hover:bg-rose-700 transition-transform active:scale-95"
            >
              <PhoneOff size={24} />
            </button>
          )}
        </div>

        <p className="mt-6 text-[11px] text-zinc-500">
          PieChat End-to-End Encrypted Voice Calling
        </p>
      </div>
    </div>
  );
}
