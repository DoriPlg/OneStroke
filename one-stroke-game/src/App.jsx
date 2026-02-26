import { useState, useEffect, useRef } from "react";
import { socket } from "./socket";
import Canvas from "./Canvas";
import { Play, Users, Trophy, Loader2 } from "lucide-react";
import {
  TURN_TIME_SECONDS,
  TOTAL_GAME_TIME_SECONDS,
  MIN_PLAYERS,
  MAX_PLAYERS
} from "../../data.js";

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
  const [myTargetWord, setMyTargetWord] = useState("");
  const [judgeResults, setJudgeResults] = useState(null);
  const [finalImage, setFinalImage] = useState(null);

  const canvasRef = useRef(null);

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

    socket.on("room-assigned", ({ roomId, players, playerTargets }) => {
      setRoomId(roomId);
      setPlayers(players);
      setGameState("in-room");
      setCurrentPlayer(players[0]);
      setGameActive(false);
      if (playerTargets && playerTargets[socket.id]) {
        setMyTargetWord(playerTargets[socket.id]);
      }
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
      // The game time is up. The first player in the room will send the final image.

      // We must grab the image data BEFORE setting gameActive to false, 
      // because once gameActive is false, the canvas might unmount or restructure.
      let finalImageData = null;
      if (canvasRef.current) {
        finalImageData = canvasRef.current.getCanvasData();
        setFinalImage(finalImageData);
      }

      setGameActive(false);
      setGameState("judging");

      if (players.length > 0 && players[0] === socket.id && finalImageData) {
        console.log("Submitting final image to judge...");
        socket.emit("submit-final-image", { imageBase64: finalImageData });
      }
    });

    socket.on("judging-started", () => {
      setGameState("judging");
    });

    socket.on("gameCompleted", (data) => {
      setJudgeResults(data);
      setGameState("completed");
    });

    socket.on("gameEnded", (data) => {
      if (data && data.error) {
        alert(`Game Error: ${data.error}`);
      }
      resetState();
    });

    socket.on("room-deleted", () => {
      console.log("Room was deleted, returning to home screen");
      resetState();
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
      socket.off("judging-started");
      socket.off("gameCompleted");
      socket.off("gameEnded");
      socket.off("room-deleted");
      socket.off("player-list");
    };
  }, [players]);

  const resetState = () => {
    setGameState("disconnected");
    setRoomId(null);
    setPlayers([]);
    setCurrentPlayer(null);
    setGameActive(false);
    setTurnTimeLeft(TURN_TIME_SECONDS);
    setGameTimeLeft(TOTAL_GAME_TIME_SECONDS);
    setMyTargetWord("");
    setJudgeResults(null);
    setWaitingCount(0);
    setFinalImage(null);
  };

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
    resetState();
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
      <div className="card">
        <h1>OneStroke</h1>
        <Loader2 className="loading-spinner" />
        <p>Connecting to server...</p>
      </div>
    );
  }

  // --- RENDERING DIFFERENT STATES ---

  if (gameState === "disconnected") {
    return (
      <div className="card">
        <h1>OneStroke</h1>
        <h2>Draw together, win alone!</h2>

        <div style={{ textAlign: "left", margin: "2rem auto", maxWidth: "400px", lineHeight: "1.8" }}>
          <p>🎨 <strong>Rules of the Game:</strong></p>
          <ol>
            <li>Every player gets a unique secret word to draw.</li>
            <li>Players share ONE single canvas.</li>
            <li>You get exactly ONE stroke per turn.</li>
            <li>Try to make the communal drawing look like YOUR word.</li>
            <li>The AI rules all! It will judge the final canvas. The player whose word it recognizes most wins!</li>
          </ol>
        </div>

        <button onClick={joinWaitingRoom} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', margin: '0 auto' }}>
          <Play size={20} /> Join Waiting Room
        </button>
      </div>
    );
  }

  if (gameState === "waiting") {
    return (
      <div className="card">
        <h1>Lobby</h1>
        <div style={{ margin: "2rem 0" }}>
          <Users size={48} style={{ opacity: 0.5, marginBottom: '1rem' }} />
          <h2>Waiting for players...</h2>

          <div className="status-badge waiting">
            {waitingCount} / {MIN_PLAYERS} Players minimum
          </div>

          <p style={{ color: 'rgba(255,255,255,0.6)' }}>
            The game will start automatically when enough players join.
          </p>
        </div>
        <button onClick={leaveGame}>Leave Queue</button>
      </div>
    );
  }

  if (gameState === "judging") {
    return (
      <div className="card">
        <h1>Time's Up!</h1>
        {finalImage && (
          <div style={{ margin: "1.5rem 0", display: "flex", justifyContent: "center" }}>
            <img src={finalImage} alt="Final Drawing" style={{ maxWidth: "100%", maxHeight: "300px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.2)", background: "white" }} />
          </div>
        )}
        <Loader2 className="loading-spinner" />
        <h2>The AI Judge is determining what this looks like...</h2>
        <p>Will it recognize your word?</p>
      </div>
    );
  }

  if (gameState === "completed" && judgeResults) {
    // Sort results by probability descending
    const sortedResults = Object.entries(judgeResults.results)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5); // Take top 5

    const didIWin = judgeResults.winnerId === myId;

    return (
      <div className="card">
        <Trophy size={64} color={didIWin ? "#ffd700" : "#a0a0a0"} style={{ marginBottom: "1rem" }} />
        <h1>{didIWin ? "You Won!" : "Game Over"}</h1>

        <div className="target-word-banner">
          The AI thinks it looks like:<br />
          <strong>{judgeResults.winnerWord}</strong> ({(judgeResults.maxProb * 100).toFixed(1)}%)
        </div>

        {finalImage && (
          <div style={{ margin: "1.5rem 0", display: "flex", justifyContent: "center" }}>
            <img src={finalImage} alt="Final Drawing" style={{ maxWidth: "100%", maxHeight: "250px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.2)", background: "white" }} />
          </div>
        )}

        <h3>Your Target Word was: <span style={{ color: didIWin ? "#2ee571" : "#ff4757" }}>{myTargetWord}</span></h3>

        <div className="results-grid">
          {sortedResults.map(([word, prob]) => (
            <div key={word} className={`result-item ${word === judgeResults.winnerWord ? 'winner' : ''}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', textTransform: 'capitalize' }}>
                <span>{word} {word === myTargetWord ? "(Yours)" : ""}</span>
                <span>{(prob * 100).toFixed(1)}%</span>
              </div>
              <div className="result-bar-bg">
                <div className="result-bar-fill" style={{ width: `${prob * 100}%` }}></div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "3rem" }}>
          <button onClick={leaveGame}>Return to Lobby</button>
        </div>
      </div>
    );
  }

  // --- IN-ROOM / PLAYING STATE ---

  return (
    <div>
      <div className="game-header">
        <div>
          <div className={`status-badge ${myTurn ? 'active' : 'waiting'}`}>
            {gameActive ? (myTurn ? "🎯 Your Turn!" : "⏳ Waiting...") : "🕐 Game starting soon..."}
          </div>
          <div style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.6)" }}>
            Room: {roomId} | Players: {players.length}
          </div>
        </div>

        {gameActive && (
          <div style={{ textAlign: "right" }}>
            <div className={`timer ${gameTimeLeft <= 10 ? 'urgent' : ''}`}>
              Game: {formatTime(gameTimeLeft)}
            </div>
            <div style={{ fontSize: "0.9rem", color: turnTimeLeft <= 3 ? "#ff4757" : "rgba(255,255,255,0.8)" }}>
              Turn ends in: {turnTimeLeft}s
            </div>
          </div>
        )}
      </div>

      <div className="target-word-banner">
        Your Secret Goal: <strong>{myTargetWord}</strong>
      </div>

      <p style={{ margin: "0.5rem 0 1rem", fontSize: "0.9rem", color: "rgba(255,255,255,0.6)" }}>
        Draw exactly <strong>ONE stroke</strong> to make the canvas look like your word!
      </p>

      <Canvas
        ref={canvasRef}
        canDraw={myTurn}
        roomId={roomId}
        onStrokeComplete={endTurn}
      />

      <div style={{ marginTop: "1rem" }}>
        <button onClick={leaveGame} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)" }}>
          Resign
        </button>
      </div>
    </div>
  );
}