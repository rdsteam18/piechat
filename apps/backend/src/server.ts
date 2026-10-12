import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: WEB_ORIGIN }));
app.use(express.json({ limit: "32kb" }));

// Extended Rate Limiter: customizable window and request allowance
const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000), // 15 minutes
  max: Number(process.env.RATE_LIMIT_MAX ?? 500), // Extended limit: 500 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests from this IP, please try again after some time."
  }
});

app.use("/api/", apiLimiter);

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    app: "PieChat API",
    status: "healthy",
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`PieChat API running on port ${PORT}`);
});
