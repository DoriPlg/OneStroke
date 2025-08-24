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
let playerRooms = {
}; // maps player IDs to room IDs
let waitingPlayers = []; // queue of participants (socket IDs)
let rooms = {};

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 5;

function getCurrentPlayer(roomId) {
    if (!rooms[roomId] || rooms[roomId].players.length === 0) return null;
    return rooms[roomId].players[rooms[roomId].turnIndex];
}

function advanceTurn(roomId) {
        const room = rooms[roomId];
        if (!room || room.players.length === 0) return;
    
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
    
        const currentPlayerId = room.players[room.turnIndex];
        io.to(roomId).emit("turnChanged", { playerId: currentPlayerId });
    }

    
function leaveRoom(socket) {
    if (waitingPlayers.includes(socket.id)) {
        waitingPlayers = waitingPlayers.filter(id => id !== socket.id);
        io.to("waiting-room").emit("waiting-count", waitingPlayers.length);
    }
    if (playerRooms[socket.id]) {
        const roomId = playerRooms[socket.id];
        rooms[roomId].players = rooms[roomId].players.filter(id => id !== socket.id);
        
        if (rooms[roomId].players.length < MIN_PLAYERS) {
            console.log(`Room ${roomId} deleted due to insufficient players.`);
            
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
    if (roomId && socket.id === getCurrentPlayer(roomId)) {
      socket.to(roomId).emit("draw-stroke", data);
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

function checkForRoomCreation() {
    while (waitingPlayers.length >= MIN_PLAYERS) {
    const roomId = `room-${crypto.randomUUID().slice(0, 6)}`;
      const playersForRoom = waitingPlayers.splice(0, MAX_PLAYERS);
      if (waitingPlayers.length > 0) {
        waitingPlayers = waitingPlayers.filter(id => !playersForRoom.includes(id));
      }
  
      rooms[roomId] = {
        players: playersForRoom,
        turnIndex: 0
      };
  
      playersForRoom.forEach(pid => {
        const socket = io.sockets.sockets.get(pid);
        playerRooms[pid] = roomId;
        socket.leave("waiting-room");
        socket.join(roomId);
        socket.emit("room-assigned", { roomId, players: playersForRoom });
      });
  
      console.log(`Room ${roomId} created with players:`, playersForRoom);
    }
  }


httpServer.listen(4000, () => {
    console.log("Server running on http://localhost:4000");
  });