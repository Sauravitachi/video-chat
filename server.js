import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import Redis from "ioredis";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });
app.use(express.static("public"));

// ✅ Connect to Redis
const redis = new Redis("redis://127.0.0.1:6379");
const WAITING_KEY = "waiting_users";
const pairs = new Map();

// 🧠 Helper: find best match based on country/interests
async function findMatch(newUser) {
  const waiting = await redis.lrange(WAITING_KEY, 0, -1);
  if (waiting.length === 0) return null;

  let best = null;
  let bestScore = 0;

  for (const raw of waiting) {
    const u = JSON.parse(raw);
    if (u.socketId === newUser.socketId) continue;

    let score = 0;
    if (u.country === newUser.country) score += 2;
    const shared = u.interests.filter((i) => newUser.interests.includes(i));
    score += shared.length;

    if (score > bestScore) {
      bestScore = score;
      best = u;
    }
  }

  if (best) {
    await redis.lrem(WAITING_KEY, 0, JSON.stringify(best));
    return best;
  }
  return null;
}

// 🚀 Socket.io connection
io.on("connection", (socket) => {
  console.log("🔗 Connected:", socket.id);

  socket.on("join_queue", async (meta) => {
    const user = {
      socketId: socket.id,
      country: meta.country || "unknown",
      interests: meta.interests || [],
    };

    const match = await findMatch(user);
    if (match) {
      pairs.set(socket.id, match.socketId);
      pairs.set(match.socketId, socket.id);
      io.to(socket.id).emit("paired", { peerId: match.socketId });
      io.to(match.socketId).emit("paired", { peerId: socket.id });
      console.log(`🤝 Matched ${socket.id} <-> ${match.socketId}`);
    } else {
      await redis.rpush(WAITING_KEY, JSON.stringify(user));
      socket.emit("waiting");
      console.log("🕓 Waiting:", socket.id, user.country, user.interests);
    }
  });

  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("message", ({ to, message }) => {
    io.to(to).emit("message", { from: socket.id, message });
  });

  socket.on("next", async () => {
    const partner = pairs.get(socket.id);
    if (partner) {
      io.to(partner).emit("partner_left");
      pairs.delete(partner);
      pairs.delete(socket.id);
      await redis.lpush(WAITING_KEY, JSON.stringify({ socketId: partner }));
    }
    await redis.lpush(WAITING_KEY, JSON.stringify({ socketId: socket.id }));
    socket.emit("waiting");
    console.log("🔄 Next:", socket.id);
  });

  socket.on("disconnect", async () => {
    console.log("❌ Disconnected:", socket.id);
    const partner = pairs.get(socket.id);
    if (partner) io.to(partner).emit("partner_left");
    pairs.delete(partner);
    pairs.delete(socket.id);
    await redis.lrem(WAITING_KEY, 0, JSON.stringify({ socketId: socket.id }));
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server running on ${PORT}`));
