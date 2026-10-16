"use client";

import { io, Socket } from "socket.io-client";

let socketInstance: Socket | null = null;
let currentToken: string | null = null;

export function getSocket(token?: string): Socket | null {
  if (typeof window === "undefined") return null;

  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

  // If a token is provided and differs from the current one, reconnect with new auth
  if (token && token !== currentToken) {
    if (socketInstance) {
      socketInstance.disconnect();
      socketInstance = null;
    }
    currentToken = token;
  }

  if (!socketInstance && currentToken) {
    socketInstance = io(backendUrl, {
      auth: { token: currentToken },
      transports: ["websocket", "polling"],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }

  return socketInstance;
}

export function disconnectSocket(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
    currentToken = null;
  }
}
