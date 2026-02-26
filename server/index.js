import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { TURN_TIME_SECONDS, TOTAL_GAME_TIME_SECONDS, MIN_PLAYERS, MAX_PLAYERS } from "../data.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load labels
const labelsPath = path.join(__dirname, "../hf_model/class_names.txt");
let availableLabels = [];
try {
  const content = fs.readFileSync(labelsPath, "utf-8");
  availableLabels = content.split(/\r?\n/).filter(l => l.trim().length > 0).map(l => l.trim());
  console.log(`Loaded ${availableLabels.length} labels from model.`);
} catch (err) {
  console.error("Error loading labels file:", err);
}

function getRandomUniqueLabels(count) {
  if (availableLabels.length < count) throw new Error("Not enough labels");
  const shuffled = [...availableLabels].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:5174"],
    methods: ["GET", "POST"]
  }
});
let playerRooms = {
}; // maps player IDs to room IDs
let waitingPlayers = []; // queue of participants (socket IDs)
let rooms = {};


function getCurrentPlayer(roomId) {
  if (!rooms[roomId] || rooms[roomId].players.length === 0) return null;
  return rooms[roomId].players[rooms[roomId].turnIndex];
}

function advanceTurn(roomId) {
  const room = rooms[roomId];
  if (!room || room.players.length === 0) return;

  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
  }

  room.turnIndex = (room.turnIndex + 1) % room.players.length;

  const currentPlayerId = room.players[room.turnIndex];

  room.turnTimer = setTimeout(() => {
    console.log(`Turn timeout for room ${roomId}, player ${currentPlayerId}`);
    io.to(roomId).emit("turnTimeout");
    advanceTurn(roomId); // Auto-advance to next player 
    // TODO: cancel whatever drawing they were doing
  }, TURN_TIME_SECONDS * 1000);

  io.to(roomId).emit("turnChanged", {
    playerId: currentPlayerId,
    turnTimeLeft: TURN_TIME_SECONDS
  });
}

function startGameTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.gameStartTime = Date.now();
  room.gameTimer = setTimeout(() => {
    console.log(`Game timeout for room ${roomId}`);

    // Stop turns from continuing while judging!
    if (room.turnTimer) clearTimeout(room.turnTimer);

    io.to(roomId).emit("gameTimeout");
    // Don't auto-end game yet, wait for client to submit the image
    // endGame(roomId);
  }, TOTAL_GAME_TIME_SECONDS * 1000);

  io.to(roomId).emit("gameStarted", {
    totalGameTime: TOTAL_GAME_TIME_SECONDS
  });
}

function endGame(roomId) { // TODO: add AI judge guessing what it is
  const room = rooms[roomId];
  if (!room) return;

  // Clear timers
  if (room.turnTimer) clearTimeout(room.turnTimer);
  if (room.gameTimer) clearTimeout(room.gameTimer);

  io.to(roomId).emit("gameEnded");

  // Move all players back to waiting room
  room.players.forEach(playerId => {
    const playerSocket = io.sockets.sockets.get(playerId);
    if (playerSocket) {
      playerSocket.leave(roomId);
      waitingPlayers.push(playerId);
      playerSocket.join("waiting-room");
    }
    delete playerRooms[playerId];
  });

  delete rooms[roomId];
  io.to("waiting-room").emit("waiting-count", waitingPlayers.length);
}


function leaveRoom(socket) {
  if (waitingPlayers.includes(socket.id)) {
    waitingPlayers = waitingPlayers.filter(id => id !== socket.id);
    io.to("waiting-room").emit("waiting-count", waitingPlayers.length);
  }
  if (playerRooms[socket.id]) {
    const roomId = playerRooms[socket.id];
    const room = rooms[roomId];

    room.players = room.players.filter(id => id !== socket.id);
    socket.leave(roomId);
    delete playerRooms[socket.id];
    console.log(`Player ${socket.id} left room ${roomId}`);

    if (room.completed) {
      // In a completed game, just quietly remove this player.
      // Only delete the room once the last player has left.
      if (room.players.length === 0) {
        delete rooms[roomId];
        console.log(`Room ${roomId} fully cleaned up after all players left.`);
      }
      // Don't broadcast room-deleted or gameEnded — other players are still on the results screen.
    } else if (room.players.length < MIN_PLAYERS) {
      // In-progress game lost too many players — tear it all down
      console.log(`Room ${roomId} deleted due to insufficient players.`);
      if (room.turnTimer) clearTimeout(room.turnTimer);
      if (room.gameTimer) clearTimeout(room.gameTimer);
      rooms[roomId].players.forEach(playerId => {
        const playerSocket = io.sockets.sockets.get(playerId);
        if (playerSocket) {
          playerSocket.leave(roomId);
          console.log(`Player ${playerId} removed from room ${roomId}.`);
        }
        delete playerRooms[playerId];
      });
      io.to(roomId).emit("room-deleted");
      delete rooms[roomId];
    } else {
      // Room still has enough players, just update the player list
      io.to(roomId).emit("player-list", rooms[roomId].players);
      if (rooms[roomId].turnIndex >= rooms[roomId].players.length) {
        rooms[roomId].turnIndex = 0;
      }
      advanceTurn(roomId);
    }
  }
}

function checkForRoomCreation() {
  while (waitingPlayers.length >= MIN_PLAYERS) {
    const roomId = `room-${crypto.randomUUID().slice(0, 6)}`;
    const playersForRoom = waitingPlayers.splice(0, MAX_PLAYERS);

    const targetWords = getRandomUniqueLabels(playersForRoom.length);
    const playerTargets = {};

    playersForRoom.forEach((playerId, index) => {
      playerTargets[playerId] = targetWords[index];
    });

    rooms[roomId] = {
      players: playersForRoom,
      playerTargets: playerTargets,
      turnIndex: 0,
      turnTimer: null,
      gameTimer: null,
      gameStartTime: null
    };

    playersForRoom.forEach(playerId => {
      const playerSocket = io.sockets.sockets.get(playerId);
      if (playerSocket) {
        playerSocket.leave("waiting-room");
        playerSocket.join(roomId);
        playerRooms[playerId] = roomId;
      }
    });

    console.log(`Room ${roomId} created with players:`, playersForRoom);
    io.to(roomId).emit("room-assigned", {
      roomId,
      players: playersForRoom,
      playerTargets: rooms[roomId].playerTargets
    });

    // Start the game and timers
    setTimeout(() => {
      startGameTimer(roomId);
      advanceTurn(roomId); // Start first turn
    }, 1000); // Give players a moment to get ready

    if (waitingPlayers.length > 0) {
      io.to("waiting-room").emit("waiting-count", waitingPlayers.length);
    }
  }
}

io.on("connection", (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on("join-game", () => {
    if (!waitingPlayers.includes(socket.id)) {
      console.log("New player:", socket.id);

      // Put player in waiting
      waitingPlayers.push(socket.id);
      socket.join("waiting-room");
      io.to("waiting-room").emit("waiting-count", waitingPlayers.length);

      checkForRoomCreation();
    }
  });

  socket.on("leave-game", () => {
    console.log(`Player ${socket.id} left the game`);
    leaveRoom(socket);
  });

  socket.on("draw-stroke", (data) => {
    const roomId = playerRooms[socket.id];
    const currentPlayer = getCurrentPlayer(roomId);

    console.log(`Draw stroke from ${socket.id}, in room ${roomId}, current player: ${currentPlayer}`);

    if (roomId && socket.id === currentPlayer) {
      console.log(`Emitting draw-stroke to room ${roomId}`);
      socket.to(roomId).emit("draw-stroke", { ...data, fromRoomId: roomId });
    } else {
      console.log(`Blocked draw-stroke: not current player or no room`);
    }
  });

  socket.on("end-turn", () => {
    const roomId = Object.keys(rooms).find(id => rooms[id].players.includes(socket.id));
    if (!roomId) return;

    // Broadcast the move to everyone in that room
    socket.to(roomId).emit("playerDrew", { playerId: socket.id });

    // Advance to the next turn in this room
    advanceTurn(roomId);
  });

  socket.on("submit-final-image", (data) => {
    const roomId = playerRooms[socket.id];
    console.log(`[DEBUG] submit-final-image received from ${socket.id}. Room ID: ${roomId}`);

    if (!roomId) {
      console.log(`[DEBUG] No roomId found for player ${socket.id}`);
      return;
    }
    const room = rooms[roomId];
    if (!room) {
      console.log(`[DEBUG] Room ${roomId} does not exist anymore in rooms object!`);
      return;
    }

    const { imageBase64 } = data;

    console.log(`Received final image for room ${roomId} to judge.`);
    io.to(roomId).emit("judging-started");

    const targetWords = Object.values(room.playerTargets);

    // Use the virtual environment's python if it exists
    const venvPythonPath = path.join(__dirname, "../OneStroke_venv/bin/python");
    const pythonExecutable = fs.existsSync(venvPythonPath) ? venvPythonPath : "python";

    // Spawn Python process
    const pythonProcess = spawn(pythonExecutable, [
      path.join(__dirname, "judge.py"),
      imageBase64,
      ...targetWords
    ]);

    let outputData = "";
    let errorData = "";

    pythonProcess.stdout.on("data", (data) => {
      const chunk = data.toString();
      outputData += chunk;
      console.log(`[PYTHON STDOUT]: ${chunk}`);
    });

    pythonProcess.stderr.on("data", (data) => {
      const chunk = data.toString();
      errorData += chunk;
      console.log(`[PYTHON STDERR]: ${chunk}`);
    });

    pythonProcess.on("close", (code) => {
      if (code !== 0) {
        console.error(`Python script exited with code ${code}. Error: ${errorData}`);
        io.to(roomId).emit("gameEnded", { error: "Failed to judge image" });
        endGame(roomId);
        return;
      }

      try {
        // Extract the JSON object from the output just in case there are warnings/prints.
        const jsonMatch = outputData.match(/\{.*\}/s);
        if (!jsonMatch) {
          throw new Error("No JSON found in Python output");
        }

        const results = JSON.parse(jsonMatch[0]);
        if (results.success) {
          const winnerWord = results.winner.trim();
          // Find which player had this word
          let winnerId = null;
          for (const [playerId, word] of Object.entries(room.playerTargets)) {
            if (word.trim() === winnerWord) {
              winnerId = playerId;
              break;
            }
          }

          io.to(roomId).emit("gameCompleted", {
            winnerId,
            winnerWord,
            maxProb: results.max_prob,
            results: results.results
          });
          // Mark room as done so any player leaving triggers full cleanup
          room.completed = true;
        } else {
          io.to(roomId).emit("gameEnded", { error: results.error || "Unknown evaluation error" });
        }
      } catch (e) {
        console.error("Failed to parse output from python:", outputData);
        console.error("Error:", e);
        io.to(roomId).emit("gameEnded", { error: "Failed to parse judge results" });
      }

      // Room cleanup is now triggered by the client clicking "Back to Lobby" 
      // via the leave-game socket event, so we don't auto-end here.
    });
  });

  socket.on("disconnect", () => {
    console.log(`Disconnected: ${socket.id}`);
    leaveRoom(socket);

  });
});


httpServer.listen(4000, () => {
  console.log("Server running on http://localhost:4000");
});