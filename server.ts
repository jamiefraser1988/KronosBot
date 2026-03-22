import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import * as tmi from "tmi.js";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const TWITCH_CHANNEL = process.env.TWITCH_CHANNEL || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Chat History for summarization
  let messageBuffer: { user: string; message: string }[] = [];
  const MAX_BUFFER = 50;

  // Twitch Integration
  let twitchClient: tmi.Client | null = null;
  let activeChannel = TWITCH_CHANNEL;
  let mockInterval: NodeJS.Timeout | null = null;

  const setupTwitch = async (channel: string) => {
    if (!channel) return;

    // If client exists, just join the new channel and part the old one
    if (twitchClient) {
      try {
        if (activeChannel && activeChannel !== channel) {
          await twitchClient.part(activeChannel);
        }
        await twitchClient.join(channel);
        activeChannel = channel;
        io.emit("system-status", { type: "twitch", status: "connected", channel });
        return;
      } catch (err) {
        console.error("Failed to switch channel, recreating client:", err);
        await twitchClient.disconnect().catch(() => {});
        twitchClient = null;
      }
    }

    // Create new client if none exists or if switch failed
    twitchClient = new tmi.Client({
      options: { debug: true },
      connection: {
        reconnect: true,
        secure: true,
        timeout: 30000
      },
      channels: [channel]
    });

    twitchClient.on("connected", (address, port) => {
      console.log(`Connected to Twitch: ${address}:${port}`);
      io.emit("system-status", { type: "twitch", status: "connected", channel });
    });

    twitchClient.on("disconnected", (reason) => {
      console.warn(`Disconnected from Twitch: ${reason}`);
      io.emit("system-status", { type: "twitch", status: "disconnected", reason });
    });

    twitchClient.on("reconnect", () => {
      console.log("Reconnecting to Twitch...");
      io.emit("system-status", { type: "twitch", status: "connecting" });
    });

    twitchClient.on("message", (chan, tags, message, self) => {
      if (self) return;

      const chatEvent = {
        user: tags["display-name"] || tags.username,
        message,
        color: tags.color || "#ffffff",
        type: "chat"
      };

      io.emit("chat-message", chatEvent);

      // Custom Commands
      if (message.startsWith("!robot stats")) {
        const stats = {
          messages: messageBuffer.length,
          users: new Set(messageBuffer.map(m => m.user)).size,
          uptime: Math.floor(process.uptime() / 60)
        };
        const statsMsg = `Kronos Stats: ${stats.messages} messages processed, ${stats.users} active users, ${stats.uptime}m uptime.`;
        io.emit("chat-message", { user: "Kronos", message: statsMsg, color: "#00ffff", type: "chat" });
      }

      if (message.startsWith("!robot dance")) {
        io.emit("robot-reaction", { type: "dance", user: chatEvent.user });
      }

      if (message.startsWith("!robot speak ")) {
        const toSpeak = message.replace("!robot speak ", "").trim();
        if (toSpeak) {
          io.emit("chat-summary", { summary: toSpeak }); // Reuse summary event for speaking
        }
      }

      // Detect mentions of the channel/streamer
      if (message.toLowerCase().includes(activeChannel.toLowerCase())) {
        io.emit("robot-reaction", { type: "mention", user: chatEvent.user });
      }

      // Detect greetings
      const greetings = ["hello", "hi", "hey", "sup", "yo", "greetings", "waving"];
      if (greetings.some(g => message.toLowerCase().includes(g))) {
        io.emit("robot-reaction", { type: "wave", user: chatEvent.user });
      }

      // Add to buffer
      messageBuffer.push({ user: chatEvent.user, message });
      if (messageBuffer.length > MAX_BUFFER) {
        messageBuffer.shift();
      }
    });

    twitchClient.on("ban", (chan, username, reason, tags) => {
      io.emit("ban-event", { user: username, reason });
    });

    twitchClient.connect().catch(err => {
      console.error(`Twitch connection failed: ${err}`);
      io.emit("system-status", { type: "twitch", status: "failed", error: String(err) });
    });
    activeChannel = channel;
  };

  const startMockMessages = () => {
    if (mockInterval) return;
    mockInterval = setInterval(() => {
      if (activeChannel) {
        clearInterval(mockInterval!);
        mockInterval = null;
        return;
      }
      const users = ["Alice", "Bob", "Charlie", "Dave"];
      const messages = ["Hello!", "Cool robot!", "Ban that guy!", "What's the consensus?", "I love this stream!"];
      const user = users[Math.floor(Math.random() * users.length)];
      const message = messages[Math.floor(Math.random() * messages.length)];
      
      const chatEvent = {
        user,
        message,
        color: "#" + Math.floor(Math.random()*16777215).toString(16),
        type: "chat"
      };
      io.emit("chat-message", chatEvent);
    }, 5000);
  };

  if (activeChannel) {
    setupTwitch(activeChannel);
  } else {
    console.log("No TWITCH_CHANNEL provided. Running in demo mode.");
    startMockMessages();
  }

  // API Routes
  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", channel: activeChannel || "demo" });
  });

  app.post("/api/channel", (req, res) => {
    const { channel } = req.body;
    if (!channel) return res.status(400).json({ error: "Channel name required" });
    
    console.log(`Switching to channel: ${channel}`);
    setupTwitch(channel);
    messageBuffer = []; // Reset buffer for new channel
    res.json({ status: "ok", channel });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
