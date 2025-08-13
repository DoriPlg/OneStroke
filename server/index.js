let players = []; // queue of participants (socket IDs)
let currentTurnIndex = 0;

function getCurrentPlayer() {
  return players.length > 0 ? players[currentTurnIndex] : null;
}

function advanceTurn() {
  if (players.length === 0) return;
  currentTurnIndex = (currentTurnIndex + 1) % players.length;
  io.emit("turn-update", { currentPlayer: getCurrentPlayer() });
}

io.on("connection", (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on("join-game", () => {
    if (!players.includes(socket.id)) {
      players.push(socket.id);
      console.log(`Joined game: ${socket.id}`);
      io.emit("player-list", players);
      io.emit("turn-update", { currentPlayer: getCurrentPlayer() });
    }
  });

  socket.on("leave-game", () => {
    const wasInGame = players.includes(socket.id);
    players = players.filter((id) => id !== socket.id);

    if (wasInGame && currentTurnIndex >= players.length) {
      currentTurnIndex = 0;
    }

    io.emit("player-list", players);
    io.emit("turn-update", { currentPlayer: getCurrentPlayer() });
  });

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
    console.log(`Disconnected: ${socket.id}`);
    players = players.filter((id) => id !== socket.id);

    if (currentTurnIndex >= players.length) {
      currentTurnIndex = 0;
    }

    io.emit("player-list", players);
    io.emit("turn-update", { currentPlayer: getCurrentPlayer() });
  });
});
