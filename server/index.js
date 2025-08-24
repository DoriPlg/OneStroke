import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { TURN_TIME_SECONDS, TOTAL_GAME_TIME_SECONDS, MIN_PLAYERS, MAX_PLAYERS } from "../data.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "http://localhost:5173",
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
        io.to(roomId).emit("gameTimeout");
        endGame(roomId);
    }, TOTAL_GAME_TIME_SECONDS * 1000);

    io.to(roomId).emit("gameStarted", { 
        totalGameTime: TOTAL_GAME_TIME_SECONDS 
    });
}

function endGame(roomId) {
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

      if (room.players.length < MIN_PLAYERS) {
          console.log(`Room ${roomId} deleted due to insufficient players.`);
          // Clear timers
          if (room.turnTimer) clearTimeout(room.turnTimer);
          if (room.gameTimer) clearTimeout(room.gameTimer);
          // Clean up all remaining players in the room
          rooms[roomId].players.forEach(playerId => {
              const playerSocket = io.sockets.sockets.get(playerId);
              if (playerSocket) {
                  playerSocket.leave(roomId);
                  console.log(`Player ${playerId} removed from room ${roomId}.`);
              }
              delete playerRooms[playerId]; // Clear their room assignment
          });
          
          // Notify all players in the room that it's being deleted
          io.to(roomId).emit("room-deleted");
          delete rooms[roomId];
      } else {
          // Room still has enough players, just update the player list
          io.to(roomId).emit("player-list", rooms[roomId].players);
          if (rooms[roomId].turnIndex >= rooms[roomId].players.length) {
              rooms[roomId].turnIndex = 0; // Reset turn index if it exceeds player count
          }
          // Advance turn to next player
          advanceTurn(roomId);
      }
      
      socket.leave(roomId);
      delete playerRooms[socket.id];
      console.log(`Player ${socket.id} left room ${roomId}`);
  }
}

function checkForRoomCreation() {
  while (waitingPlayers.length >= MIN_PLAYERS) {
    const roomId = `room-${crypto.randomUUID().slice(0, 6)}`;
      const playersForRoom = waitingPlayers.splice(0, MAX_PLAYERS);
        
      rooms[roomId] = {
        players: playersForRoom,
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
      io.to(roomId).emit("room-assigned", { roomId, players: playersForRoom });
        
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
            socket.to(roomId).emit("draw-stroke", {...data, fromRoomId: roomId});
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
  
    socket.on("disconnect", () => {
      console.log(`Disconnected: ${socket.id}`);
      leaveRoom(socket);
  
    });
  });
  

httpServer.listen(4000, () => {
    console.log("Server running on http://localhost:4000");
  });