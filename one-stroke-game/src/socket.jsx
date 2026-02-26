import { io } from "socket.io-client";

// Connect to the backend at port 4000
const backendUrl = window.location.hostname === 'localhost' ? 'http://localhost:4000' : '/';
export const socket = io(backendUrl);
