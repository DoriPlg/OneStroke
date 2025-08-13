import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { socket } from './socket'

socket.on("waiting-count", (count) => {
  setWaitingMessage(`Waiting for players... ${count} in queue`);
});

socket.on("room-assigned", ({ roomId, players }) => {
  setRoomId(roomId);
  setPlayers(players);
});


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
