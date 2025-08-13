import { useRef, useState, useEffect } from "react";
import { socket } from "./socket";


export default function Canvas({ canDraw }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const [drawing, setDrawing] = useState(false);

  // Setup canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = 800;
    canvas.height = 500;
    const ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "black";
    ctxRef.current = ctx;
  }, []);

  // Receive strokes from server
  useEffect(() => {
    socket.on("draw-stroke", ({ x0, y0, x1, y1 }) => {
      drawLine(x0, y0, x1, y1);
    });
    return () => socket.off("draw-stroke");
  }, []);

  const startDrawing = (e) => {
    if (!canDraw) throw new Error("Not allowed to draw, wait for your turn");
    setDrawing(true);
    ctxRef.current.beginPath();
    ctxRef.current.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  };

  const draw = (e) => {
    if (!drawing || !canDraw) return;
    const x = e.nativeEvent.offsetX;
    const y = e.nativeEvent.offsetY;

    // Draw locally
    ctxRef.current.lineTo(x, y);
    ctxRef.current.stroke();

    // Send to others
    socket.emit("draw-stroke", {
      x0: ctxRef.current.lastX ?? x,
      y0: ctxRef.current.lastY ?? y,
      x1: x,
      y1: y,
    });

    ctxRef.current.lastX = x;
    ctxRef.current.lastY = y;
  };

  const stopDrawing = () => {
    if (!drawing) return;
    setDrawing(false);
    ctxRef.current.lastX = null;
    ctxRef.current.lastY = null;
    socket.emit("end-turn");
  };

  const drawLine = (x0, y0, x1, y1) => {
    ctxRef.current.beginPath();
    ctxRef.current.moveTo(x0, y0);
    ctxRef.current.lineTo(x1, y1);
    ctxRef.current.stroke();
    ctxRef.current.closePath();
  };

  return (
    <canvas
      ref={canvasRef}
      style={{ border: "1px solid black", background: "white" }}
      onMouseDown={startDrawing}
      onMouseMove={draw}
      onMouseUp={stopDrawing}
      onMouseLeave={stopDrawing}
    />
  );
}
