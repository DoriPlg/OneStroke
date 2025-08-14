import { useState, useEffect } from "react";
import { socket } from "./socket";
import Canvas from "./Canvas";

export default function App() {
  const [gameState, setGameState] = useState("disconnected"); // "disconnected", "waiting", "in-room"
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [myId, setMyId] = useState(null);
  const [players, setPlayers] = useState([]);
  const [waitingCount, setWaitingCount] = useState(0);
  const [roomId, setRoomId] = useState(null);

  useEffect(() => {
    setMyId(socket.id);

    // Handle waiting room events
    socket.on("waiting-count", (count) => {
      setWaitingCount(count);
    });

    // Handle room assignment
    socket.on("room-assigned", ({ roomId, players }) => {
      setRoomId(roomId);
      setPlayers(players);
      setGameState("in-room");
      // Set first player as current player initially
      setCurrentPlayer(players[0]);
    });

    // Handle turn changes
    socket.on("turnChanged", ({ playerId }) => {
      setCurrentPlayer(playerId);
    });

    // Handle room deletion - return to home
    socket.on("room-deleted", () => {
      setGameState("disconnected");
      setRoomId(null);
      setPlayers([]);
      setCurrentPlayer(null);
    });

    // Handle player list updates in room
    socket.on("player-list", (updatedPlayers) => {
      setPlayers(updatedPlayers);
    });

    return () => {
      socket.off("waiting-count");
      socket.off("room-assigned");
      socket.off("turnChanged");
      socket.off("room-deleted");
      socket.off("player-list");
    };
  }, []);

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
  };

  const endTurn = () => {
    socket.emit("end-turn");
  };

  const myTurn = gameState === "in-room" && currentPlayer === myId;

  // Disconnected/Home screen
  if (gameState === "disconnected") {
    return (
      <div>
        <h1>One Stroke Game</h1>
        <p>Welcome! Click below to join the waiting room.</p>
        <button onClick={joinWaitingRoom}>Join Waiting Room</button>
      </div>
    );
  }

  // Waiting room screen
  if (gameState === "waiting") {
    return (
      <div>
        <h1>One Stroke Game</h1>
        <p>Waiting for players... {waitingCount} in queue</p>
        <p>Need 3 players minimum to start a room.</p>
        <button onClick={leaveGame}>Leave Waiting Room</button>
      </div>
    );
  }

  // In-room playing screen
  return (
    <div>
      <h1>One Stroke Game</h1>
      <p>Room: {roomId}</p>
      <p>Players: {players.join(", ")}</p>
      <p>Current Turn: {currentPlayer || "None"}</p>

      <button onClick={leaveGame}>Leave Room</button>

      {myTurn ? <p>🎯 Your Turn!</p> : <p>⏳ Waiting...</p>}

      <Canvas canDraw={myTurn} />

      {myTurn && (
        <button onClick={endTurn} style={{ marginTop: "10px" }}>
          End My Turn
        </button>
      )}
    </div>
  );
}