import { useState, useEffect } from "react";
import { io } from "socket.io-client";
import Canvas from "./Canvas";


const socket = io("http://localhost:4000");

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    socket.on("chat-message", (msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    return () => socket.off("chat-message");
  }, []);

  const sendMessage = () => {
    socket.emit("chat-message", input);
    setInput("");
  };

  return (
    <div>
      <h1>One Stroke Game</h1>
      <div>
        {messages.map((m, i) => <div key={i}>{m}</div>)}
      </div>
      <input value={input} onChange={e => setInput(e.target.value)} />
      <button onClick={sendMessage}>Send</button>
      <Canvas canDraw={true} /> {/* later we’ll make this turn-based */}
    </div>
  );
}
