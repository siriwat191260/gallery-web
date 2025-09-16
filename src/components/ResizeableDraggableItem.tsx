// components/ResizableDraggableItem.tsx
"use client";
import React, { useEffect, useRef } from "react";
import interact from "interactjs";

type Props = {
  src: string;
  alt?: string;
  x: number; y: number; w: number; h: number;
  onChange: (next: {x:number;y:number;w:number;h:number}) => void;
};

export default function ResizableDraggableItem({ src, alt, x, y, w, h, onChange }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    // Draggable
    interact(ref.current)
      .draggable({
        listeners: {
          move (event) {
            const el = event.target as HTMLElement;
            const dx = event.dx ?? 0;
            const dy = event.dy ?? 0;
            const nx = (parseFloat(el.dataset.x || "0") || 0) + dx;
            const ny = (parseFloat(el.dataset.y || "0") || 0) + dy;
            el.style.transform = `translate(${nx}px, ${ny}px)`;
            el.dataset.x = String(nx);
            el.dataset.y = String(ny);
          },
          end (event) {
            const el = event.target as HTMLElement;
            onChange({
              x: parseFloat(el.dataset.x || "0") || 0,
              y: parseFloat(el.dataset.y || "0") || 0,
              w: el.clientWidth,
              h: el.clientHeight,
            });
          },
        }
      })
      .styleCursor(false) // let CSS decide
      // Resizable
      .resizable({
        edges: { left: true, right: true, bottom: true, top: true },
        listeners: {
          move (event) {
            const el = event.target as HTMLElement;
            let { width, height } = event.rect;
            // maintain minimums
            width = Math.max(80, width);
            height = Math.max(80, height);
            el.style.width = width + "px";
            el.style.height = height + "px";

            // keep the dragged translation in sync when resizing from top/left
            const x = (parseFloat(el.dataset.x || "0") || 0) + (event.deltaRect?.left || 0);
            const y = (parseFloat(el.dataset.y || "0") || 0) + (event.deltaRect?.top || 0);
            el.style.transform = `translate(${x}px, ${y}px)`;
            el.dataset.x = String(x);
            el.dataset.y = String(y);
          },
          end (event) {
            const el = event.target as HTMLElement;
            onChange({
              x: parseFloat(el.dataset.x || "0") || 0,
              y: parseFloat(el.dataset.y || "0") || 0,
              w: el.clientWidth,
              h: el.clientHeight,
            });
          }
        },
        modifiers: [
          interact.modifiers.restrictEdges({ outer: 'parent' }),
          interact.modifiers.restrictSize({ min: { width: 80, height: 80 } }),
        ],
        inertia: true,
      });

    // init size & position
    const el = ref.current!;
    el.style.width = w + "px";
    el.style.height = h + "px";
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.dataset.x = String(x);
    el.dataset.y = String(y);

    return () => interact(ref.current!).unset();
  }, [onChange, w, h, x, y]);

  return (
    <div ref={ref} className="absolute select-none rounded-xl overflow-hidden shadow border bg-white">
      <img src={src} alt={alt || ""} className="block w-full h-full object-cover" draggable={false}/>
    </div>
  );
}
