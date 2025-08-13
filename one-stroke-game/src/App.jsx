import { useState, useEffect } from "react";
import { io } from "socket.io-client";
import Canvas from "./Canvas";

const socket = io("http://localhost:4000");

export default function App() {
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [myId, setMyId] = useState(null);
  const [players, setPlayers] = useState([]);

  useEffect(() => {
    setMyId(socket.id);

    socket.on("player-list", setPlayers);
    socket.on("turn-update", ({ currentPlayer }) => {
      setCurrentPlayer(currentPlayer);
    });

    return () => {
      socket.off("player-list");
      socket.off("turn-update");
    };
  }, []);

  const endTurn = () => {
    socket.emit("end-turn");
  };

  const myTurn = currentPlayer === myId;

  return (
    <div>
      <h1>One Stroke Game</h1>
      <p>Players: {players.join(", ")}</p>
      <p>Current Turn: {currentPlayer}</p>
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
