import { useState, useEffect } from "react";
import { socket } from "./socket";
import Canvas from "./Canvas";


export default function App() {
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [myId, setMyId] = useState(null);
  const [players, setPlayers] = useState([]);
  const [inGame, setInGame] = useState(false);

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

  const joinGame = () => {
    socket.emit("join-game");
    setInGame(true);
  };

  const leaveGame = () => {
    socket.emit("leave-game");
    setInGame(false);
  };

  const endTurn = () => {
    socket.emit("end-turn");
  };

  const myTurn = inGame && currentPlayer === myId;

  return (
    <body onunload={leaveGame}>
    <div>
      <h1>One Stroke Game</h1>
      <p>Players: {players.join(", ")}</p>
      <p>Current Turn: {currentPlayer || "None"}</p>

      {!inGame ? (
        <button onClick={joinGame}>Join Game</button>
      ) : (
        <button onClick={leaveGame}>Leave Game</button>
      )}

      {myTurn ? <p>🎯 Your Turn!</p> : inGame ? <p>⏳ Waiting...</p> : <p>—</p>}

      <Canvas canDraw={myTurn} />

      {myTurn && (
        <button onClick={endTurn} style={{ marginTop: "10px" }}>
          End My Turn
        </button>
      )}
    </div>
    </body>
  );
}
