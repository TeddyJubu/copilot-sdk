// Local demo only. Add application authentication, authorization and quotas before deployment.
import "dotenv/config";
import express from "express";
import { generateImage } from "@yourgpt/llm-sdk";
import { openaiImage, openaiRealtime } from "@yourgpt/llm-sdk/openai";

const app = express();
app.use(express.json({ limit: "80kb" }));
let inFlight = 0;
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (
    req.method !== "POST" ||
    !["http://localhost:3033", "http://127.0.0.1:3033"].includes(
      req.headers.origin ?? "",
    )
  ) {
    res.status(403).json({ error: "Use the local media demo" });
    return;
  }
  if (inFlight >= 2) {
    res.status(429).json({ error: "Wait for the current request" });
    return;
  }
  inFlight++;
  res.once("close", () => {
    inFlight--;
  });
  next();
});
app.post("/media-api/realtime", async (req, res) => {
  const controller = new AbortController();
  res.once("close", () => controller.abort());
  try {
    const result = await openaiRealtime().createCall({
      sdp: req.body.sdp,
      signal: controller.signal,
      transcriptionModel: "gpt-transcribe",
      instructions:
        "You are the Copilot SDK voice demo. Speak briefly. If asked for the demo status, call get_demo_status and read the returned status. Tell the user this is an AI voice.",
      tools: [
        {
          name: "get_demo_status",
          description: "Read the local demo status after user approval",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ],
    });
    res.json(result);
  } catch {
    if (!res.destroyed)
      res.status(502).json({
        error: "Voice setup failed; check provider access on the server",
      });
  }
});
app.post("/media-api/image", async (req, res) => {
  const controller = new AbortController();
  res.once("close", () => controller.abort());
  try {
    if (typeof req.body.prompt !== "string" || req.body.prompt.length > 1000) {
      res.status(400).json({ error: "Enter a prompt up to 1000 characters" });
      return;
    }
    const result = await generateImage({
      model: openaiImage(),
      prompt: req.body.prompt,
      size: "1024x1024",
      signal: controller.signal,
      providerOptions: { openai: { quality: "low" } },
    });
    res.json({
      base64: result.image.base64,
      mediaType: result.image.mediaType,
      usage: result.usage,
    });
  } catch {
    if (!res.destroyed)
      res.status(502).json({
        error: "Image generation failed; check provider access on the server",
      });
  }
});
app.listen(3034, "127.0.0.1", () =>
  console.log(
    "Media demo API at http://127.0.0.1:3034; open http://localhost:3033/media.html",
  ),
);
