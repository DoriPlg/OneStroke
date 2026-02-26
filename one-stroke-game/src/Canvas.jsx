import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { socket } from "./socket";

const Canvas = forwardRef(({ canDraw, roomId, onStrokeComplete }, ref) => {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasDrawnStroke, setHasDrawnStroke] = useState(false); // Track if user drew their one stroke

  useImperativeHandle(ref, () => ({
    getCanvasData: () => {
      if (canvasRef.current) {
        return canvasRef.current.toDataURL("image/png");
      }
      return null;
    }
  }));

  // Reset stroke state when it becomes our turn again
  useEffect(() => {
    if (canDraw) {
      setHasDrawnStroke(false);
    }
  }, [canDraw]);

  // Setup canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = 800;
    canvas.height = 500;
    const ctx = canvas.getContext("2d");

    // Fill with white background initially so the image data is correct
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "black";
    ctxRef.current = ctx;
  }, []);

  // Receive strokes from server
  useEffect(() => {
    const handleDrawStroke = ({ x0, y0, x1, y1, fromRoomId }) => {
      // ONLY draw if the stroke is from our current room
      if (fromRoomId === roomId) {
        drawLine(x0, y0, x1, y1);
      }
    };

    socket.on("draw-stroke", handleDrawStroke);
    return () => socket.off("draw-stroke", handleDrawStroke);
  }, [roomId]);

  const startDrawing = (e) => {
    if (!canDraw || hasDrawnStroke) return; // Enforce only one stroke!

    setDrawing(true);
    ctxRef.current.beginPath();
    ctxRef.current.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  };

  const draw = (e) => {
    if (!drawing || !canDraw || hasDrawnStroke) return;
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

    // Mark that they've drawn their stroke
    setHasDrawnStroke(true);

    if (onStrokeComplete) {
      onStrokeComplete();
    }
  };

  const drawLine = (x0, y0, x1, y1) => {
    ctxRef.current.beginPath();
    ctxRef.current.moveTo(x0, y0);
    ctxRef.current.lineTo(x1, y1);
    ctxRef.current.stroke();
    ctxRef.current.closePath();
  };

  return (
    <div className={`canvas-container ${canDraw && !hasDrawnStroke ? 'my-turn' : ''}`}>
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        style={{ cursor: canDraw && !hasDrawnStroke ? 'crosshair' : 'not-allowed' }}
      />
    </div>
  );
});

export default Canvas;
