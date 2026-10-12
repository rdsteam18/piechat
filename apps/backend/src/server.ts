import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: WEB_ORIGIN }));
app.use(express.json({ limit: "32kb" }));

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
