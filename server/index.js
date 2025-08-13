import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

let players = []; // list of socket IDs
let currentTurnIndex = 0;

function getCurrentPlayer() {
  return players[currentTurnIndex];
}

function advanceTurn() {
  if (players.length === 0) return;
  currentTurnIndex = (currentTurnIndex + 1) % players.length;
  io.emit("turn-update", { currentPlayer: getCurrentPlayer() });
}

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  players.push(socket.id);

  // Send initial turn info
  io.emit("player-list", players);
  io.emit("turn-update", { currentPlayer: getCurrentPlayer() });

  socket.on("draw-stroke", (data) => {
    if (socket.id === getCurrentPlayer()) {
      socket.broadcast.emit("draw-stroke", data);
    }
  });

  socket.on("end-turn", () => {
    if (socket.id === getCurrentPlayer()) {
      advanceTurn();
    }
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    players = players.filter((id) => id !== socket.id);

    // Adjust turn index if necessary
    if (currentTurnIndex >= players.length) {
      currentTurnIndex = 0;
    }

    io.emit("player-list", players);
    io.emit("turn-update", { currentPlayer: getCurrentPlayer() });
  });
});

httpServer.listen(4000, () => {
  console.log("Server running on http://localhost:4000");
});
