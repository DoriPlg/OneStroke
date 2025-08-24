import { useState, useEffect } from "react";
import { socket } from "./socket";
import Canvas from "./Canvas";
import { 
  TURN_TIME_SECONDS,
  TOTAL_GAME_TIME_SECONDS,
  MIN_PLAYERS,
  MAX_PLAYERS } from "../../data.js";

export default function App() {
  const [gameState, setGameState] = useState("disconnected");
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [myId, setMyId] = useState(null);
  const [players, setPlayers] = useState([]);
  const [waitingCount, setWaitingCount] = useState(0);
  const [roomId, setRoomId] = useState(null);
  const [turnTimeLeft, setTurnTimeLeft] = useState(TURN_TIME_SECONDS);
  const [gameTimeLeft, setGameTimeLeft] = useState(TOTAL_GAME_TIME_SECONDS);
  const [gameActive, setGameActive] = useState(false);

  useEffect(() => {
    const handleConnect = () => {
      setMyId(socket.id);
    };

    if (socket.connected) {
      setMyId(socket.id);
    }

    socket.on("connect", handleConnect);

    socket.on("waiting-count", (count) => {
      setWaitingCount(count);
    });

    socket.on("room-assigned", ({ roomId, players }) => {
      setRoomId(roomId);
      setPlayers(players);
      setGameState("in-room");
      setCurrentPlayer(players[0]);
      setGameActive(false); // Game hasn't started yet
    });

    socket.on("gameStarted", ({ totalGameTime }) => {
      setGameActive(true);
      setGameTimeLeft(totalGameTime);
    });

    socket.on("turnChanged", ({ playerId, turnTimeLeft }) => {
      setCurrentPlayer(playerId);
      setTurnTimeLeft(turnTimeLeft);
    });

    socket.on("turnTimeout", () => {
      console.log("Turn timed out!");
    });

    socket.on("gameTimeout", () => {
      alert("Game time is up!");
    });

    socket.on("gameEnded", () => {
      setGameState("disconnected");
      setRoomId(null);
      setPlayers([]);
      setCurrentPlayer(null);
      setGameActive(false);
      setTurnTimeLeft(TURN_TIME_SECONDS);
      setGameTimeLeft(TOTAL_GAME_TIME_SECONDS);
    });

    socket.on("room-deleted", () => {
      console.log("Room was deleted, returning to home screen");
      setGameState("disconnected");
      setRoomId(null);
      setPlayers([]);
      setCurrentPlayer(null);
      setWaitingCount(0);
      setGameActive(false);
      setTurnTimeLeft(TURN_TIME_SECONDS);
      setGameTimeLeft(TOTAL_GAME_TIME_SECONDS);
    });

    socket.on("player-list", (updatedPlayers) => {
      setPlayers(updatedPlayers);
    });

    return () => {
      socket.off("connect", handleConnect);
      socket.off("waiting-count");
      socket.off("room-assigned");
      socket.off("gameStarted");
      socket.off("turnChanged");
      socket.off("turnTimeout");
      socket.off("gameTimeout");
      socket.off("gameEnded");
      socket.off("room-deleted");
      socket.off("player-list");
    };
  }, []);

  // Turn timer countdown
  useEffect(() => {
    if (!gameActive || !currentPlayer) return;

    const interval = setInterval(() => {
      setTurnTimeLeft(prev => {
        if (prev <= 1) {
          return TURN_TIME_SECONDS; // Reset for next turn
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [currentPlayer, gameActive]);

  // Game timer countdown
  useEffect(() => {
    if (!gameActive) return;

    const interval = setInterval(() => {
      setGameTimeLeft(prev => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [gameActive]);

  const joinWaitingRoom = () => {
    socket.emit("join-game");
    setGameState("waiting");
  };

  const leaveGame = () => {
    socket.emit("leave-game");
    setGameState("disconnected");
    setRoomId(null);
    setPlayers([]);
    setCurrentPlayer(null);
    setWaitingCount(0);
    setGameActive(false);
    setTurnTimeLeft(TURN_TIME_SECONDS);
    setGameTimeLeft(TOTAL_GAME_TIME_SECONDS);
  };

  const endTurn = () => {
    socket.emit("end-turn");
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const myTurn = gameState === "in-room" && currentPlayer === myId && gameActive;

  if (!myId) {
    return (
      <div>
        <h1>One Stroke Game</h1>
        <p>Connecting...</p>
      </div>
    );
  }

  if (gameState === "disconnected") {
    return (
      <div>
        <h1>One Stroke Game</h1>
        <p>Welcome! Click below to join the waiting room.</p>
        <button onClick={joinWaitingRoom}>Join Waiting Room</button>
      </div>
    );
  }

  if (gameState === "waiting") {
    return (
      <div>
        <h1>One Stroke Game</h1>
        <p>Waiting for players... {waitingCount} in queue</p>
        <p>Need {MIN_PLAYERS} players minimum to start a room.</p>
        <button onClick={leaveGame}>Leave Waiting Room</button>
      </div>
    );
  }

  return (
    <div>
      <h1>One Stroke Game</h1>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <p>Room: {roomId}</p>
        {gameActive && (
          <div style={{ display: 'flex', gap: '20px' }}>
            <p style={{ color: turnTimeLeft <= 3 ? 'red' : 'black' }}>
              Turn: {turnTimeLeft}s
            </p>
            <p style={{ color: gameTimeLeft <= 30 ? 'red' : 'black' }}>
              Game: {formatTime(gameTimeLeft)}
            </p>
          </div>
        )}
      </div>
      
      <p>Players: {players.join(", ")}</p>
      <p>Current Turn: {currentPlayer || "None"}</p>

      {!gameActive && <p>🕐 Game starting soon...</p>}
      {gameActive && (myTurn ? <p>🎯 Your Turn!</p> : <p>⏳ Waiting...</p>)}

      <button onClick={leaveGame}>Leave Room</button>

      <Canvas canDraw={myTurn} roomId={roomId} />

      {myTurn && (
        <button onClick={endTurn} style={{ marginTop: "10px" }}>
          End My Turn
        </button>
      )}
    </div>
  );
}