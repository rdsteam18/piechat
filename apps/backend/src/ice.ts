import crypto from "crypto";
import { Request, Response } from "express";
import { verifyUserToken } from "./db.js";

export function generateTurnCredentials(
  userId: string,
  secret: string,
  urls: string[],
  ttlSeconds = 3600
) {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiry}:${userId}`;
  const credential = crypto
    .createHmac("sha1", secret)
    .update(username)
    .digest("base64");

  return {
    urls,
    username,
    credential,
    ttl: ttlSeconds,
  };
}

export const DEFAULT_STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

export async function getIceConfigHandler(req: Request, res: Response) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing authorization token" });
  }

  const user = await verifyUserToken(token);
  if (!user) {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }

  const turnSecret = process.env.TURN_SECRET || process.env.COTURN_STATIC_AUTH_SECRET;
  const turnUrls = process.env.TURN_URLS || process.env.COTURN_URLS;

  if (turnSecret && turnUrls) {
    const urls = turnUrls.split(",").map((u) => u.trim());
    const turnConfig = generateTurnCredentials(user.id, turnSecret, urls);

    return res.json({
      ok: true,
      iceServers: [
        ...DEFAULT_STUN_SERVERS,
        {
          urls: turnConfig.urls,
          username: turnConfig.username,
          credential: turnConfig.credential,
        },
      ],
      ttl: turnConfig.ttl,
    });
  }

  return res.json({
    ok: true,
    iceServers: DEFAULT_STUN_SERVERS,
    ttl: 86400,
  });
}
