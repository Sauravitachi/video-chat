import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

app.use(express.static("public"));

/* ===== Matchmaking Queue ===== */
let waiting = [];
const pairs = new Map();

io.on("connection", (socket) => {
  console.log("🔗 Connected:", socket.id);

  socket.on("join_queue", () => {
    console.log("🕓", socket.id, "joined queue");
    if (waiting.length > 0) {
      const partner = waiting.shift();
      pairs.set(socket.id, partner);
      pairs.set(partner, socket.id);
      io.to(socket.id).emit("paired", { peerId: partner });
      io.to(partner).emit("paired", { peerId: socket.id });
    } else {
      waiting.push(socket.id);
    }
  });

  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("message", ({ to, message }) => {
    io.to(to).emit("message", { from: socket.id, message });
  });

  socket.on("next", () => {
    const partner = pairs.get(socket.id);
    if (partner) {
      io.to(partner).emit("partner_left");
      pairs.delete(partner);
      pairs.delete(socket.id);
      waiting.push(partner);
    }
    waiting.push(socket.id);
    socket.emit("waiting");
    console.log("🔄", socket.id, "requested next");
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);
    const partner = pairs.get(socket.id);
    if (partner) io.to(partner).emit("partner_left");
    pairs.delete(partner);
    pairs.delete(socket.id);
    waiting = waiting.filter((id) => id !== socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server running on ${PORT}`));
