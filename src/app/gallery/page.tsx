// app/gallery/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import interact from "interactjs";

/* -------------------- Firebase init -------------------- */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function ensureFirebase() {
  if (!getApps().length) initializeApp(firebaseConfig);
  return { db: getFirestore(), storage: getStorage() } as const;
}

/* -------------------- Types & helpers -------------------- */
type GalleryItem = {
  id?: string;
  url: string;
  fileName?: string;
  createdAt?: any;
  // stored layout
  x: number;
  y: number;
  w: number;
  h: number;
  caption?: string | null;
};

type PendingFile = {
  file: File;
  previewUrl: string;
  x: number;
  y: number;
  w: number;
  h: number;
  caption?: string;
};

function readImageDims(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.width, h: img.height });
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

function cls(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

/* -------------------- Draggable + Resizable item -------------------- */
function ResizableDraggableItem({
  src,
  alt,
  x,
  y,
  w,
  h,
  snap = false,
  onChange,
}: {
  src: string;
  alt?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  snap?: boolean;
  onChange: (next: { x: number; y: number; w: number; h: number }) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const mods = [
      interact.modifiers.restrictEdges({ outer: "parent" }),
      interact.modifiers.restrictSize({ min: { width: 80, height: 80 } }),
    ];

    if (snap) {
      const step = 8;
      mods.push(
        interact.modifiers.snap({
          targets: [interact.snappers.grid({ x: step, y: step })],
          range: step,
        })
      );
    }

    const i = interact(ref.current)
      .draggable({
        listeners: {
          move(event) {
            const el = event.target as HTMLElement;
            const nx = (parseFloat(el.dataset.x || "0") || 0) + (event.dx ?? 0);
            const ny = (parseFloat(el.dataset.y || "0") || 0) + (event.dy ?? 0);
            el.style.transform = `translate(${nx}px, ${ny}px)`;
            el.dataset.x = String(nx);
            el.dataset.y = String(ny);
          },
          end(event) {
            const el = event.target as HTMLElement;
            onChange({
              x: parseFloat(el.dataset.x || "0") || 0,
              y: parseFloat(el.dataset.y || "0") || 0,
              w: el.clientWidth,
              h: el.clientHeight,
            });
          },
        },
        modifiers: mods,
        inertia: true,
      })
      .resizable({
        edges: { left: true, right: true, bottom: true, top: true },
        listeners: {
          move(event) {
            const el = event.target as HTMLElement;
            let { width, height } = event.rect;
            width = Math.max(80, width);
            height = Math.max(80, height);
            el.style.width = width + "px";
            el.style.height = height + "px";
            const nx =
              (parseFloat(el.dataset.x || "0") || 0) + (event.deltaRect?.left || 0);
            const ny =
              (parseFloat(el.dataset.y || "0") || 0) + (event.deltaRect?.top || 0);
            el.style.transform = `translate(${nx}px, ${ny}px)`;
            el.dataset.x = String(nx);
            el.dataset.y = String(ny);
          },
          end(event) {
            const el = event.target as HTMLElement;
            onChange({
              x: parseFloat(el.dataset.x || "0") || 0,
              y: parseFloat(el.dataset.y || "0") || 0,
              w: el.clientWidth,
              h: el.clientHeight,
            });
          },
        },
        modifiers: mods,
        inertia: true,
      });

    // init
    const el = ref.current!;
    el.style.width = w + "px";
    el.style.height = h + "px";
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.dataset.x = String(x);
    el.dataset.y = String(y);

    return () => i.unset();
  }, [onChange, w, h, x, y, snap]);

  return (
    <div
      ref={ref}
      className="absolute select-none rounded-xl overflow-hidden shadow border bg-white"
    >
      <img
        src={src}
        alt={alt || ""}
        className="block w-full h-full object-cover"
        draggable={false}
      />
    </div>
  );
}

/* -------------------- Page -------------------- */
export default function GalleryPage() {
  const { db, storage } = ensureFirebase();

  // Saved items (Firestore)
  const [items, setItems] = useState<GalleryItem[]>([]);

  // Pending previews (before save)
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [snap, setSnap] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Subscribe to saved items
  useEffect(() => {
    const q = query(
      collection(db, "galleries", "default", "items"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: GalleryItem[] = [];
      snap.forEach((doc) => list.push({ id: doc.id, ...(doc.data() as any) }));
      setItems(list);
    });
    return () => unsub();
  }, [db]);

  // Clean object URLs on unmount
  useEffect(() => {
    return () => pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Select images → create preview boxes with initial layout
  const onSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (!files.length) return;

    const entries: PendingFile[] = [];
    for (const f of files) {
      const previewUrl = URL.createObjectURL(f);
      const dims = await readImageDims(f);
      const baseW = 260;
      const ratio =
        dims && dims.w > 0 ? Math.max(0.3, (dims.h ?? 1) / (dims.w ?? 1)) : 0.66;
      const baseH = Math.max(160, Math.round(baseW * ratio));
      const n = pending.length + entries.length;
      entries.push({
        file: f,
        previewUrl,
        w: baseW,
        h: baseH,
        x: 16 * n,
        y: 16 * n,
      });
    }
    setPending((prev) => [...prev, ...entries]);
    if (inputRef.current) inputRef.current.value = "";
  };

  // Remove a pending preview
  const removeOne = (idx: number) => {
    setPending((prev) => {
      const copy = [...prev];
      const [removed] = copy.splice(idx, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return copy;
    });
  };

  // Save → upload each pending file and write Firestore doc (with layout)
  const onSave = async () => {
    if (!pending.length) return;
    setIsSaving(true);
    try {
      for (const p of pending) {
        const key = `galleries/default/${Date.now()}_${p.file.name}`;
        const ref = storageRef(storage, key);
        await uploadBytes(ref, p.file, { contentType: p.file.type });
        const url = await getDownloadURL(ref);

        await addDoc(collection(db, "galleries", "default", "items"), {
          url,
          fileName: p.file.name,
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
          caption: p.caption ?? null,
          createdAt: serverTimestamp(),
        });
      }
      // Clear previews
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPending([]);
    } finally {
      setIsSaving(false);
    }
  };

  const canSave = pending.length > 0 && !isSaving;

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8 space-y-6">
      {/* Header */}
      <header className="grid gap-4 md:grid-cols-2 md:items-center">
        <div>
          <h1 className="text-2xl font-semibold">Web Gallery — Drag & Resize Preview</h1>
          <p className="text-sm opacity-70">
            Pick images → arrange them (drag/resize) → Save uploads to Firebase Storage and writes
            Firestore with layout (x,y,w,h). Saved canvas below updates live.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl shadow border cursor-pointer hover:shadow-md">
            <span>➕ Add images</span>
            <input
              ref={inputRef}
              onChange={onSelect}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
            />
          </label>

          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border">
            <input
              type="checkbox"
              checked={snap}
              onChange={(e) => setSnap(e.target.checked)}
            />
            <span className="text-sm">Snap to 8px</span>
          </label>

          <button
            onClick={onSave}
            disabled={!canSave}
            className={cls(
              "px-4 py-2 rounded-2xl border shadow",
              canSave ? "hover:shadow-md" : "opacity-50 cursor-not-allowed"
            )}
          >
            {isSaving ? "Saving…" : `Save${pending.length ? ` (${pending.length})` : ""}`}
          </button>
        </div>
      </header>

      {/* PREVIEW canvas (draggable/resizable) */}
      {pending.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-sm font-medium opacity-70">Preview (not saved yet)</h2>
          <div className="relative w-full min-h-[420px] rounded-2xl border bg-[--color-foreground]/5 overflow-hidden">
            {pending.map((p, idx) => (
              <React.Fragment key={idx}>
                <ResizableDraggableItem
                  src={p.previewUrl}
                  alt={p.file.name}
                  x={p.x}
                  y={p.y}
                  w={p.w}
                  h={p.h}
                  snap={snap}
                  onChange={(next) => {
                    setPending((prev) => {
                      const copy = [...prev];
                      copy[idx] = { ...copy[idx], ...next };
                      return copy;
                    });
                  }}
                />
                {/* small remove button */}
                <button
                  type="button"
                  onClick={() => removeOne(idx)}
                  className="absolute text-xs rounded-md px-2 py-1 bg-black/70 text-white"
                  style={{ transform: `translate(${p.x + p.w - 28}px, ${p.y + 8}px)` }}
                  aria-label="Remove"
                  title="Remove"
                >
                  ✕
                </button>
              </React.Fragment>
            ))}
          </div>
        </section>
      )}

      {/* SAVED canvas (from Firestore, read-only) */}
      <section className="grid gap-2">
        <h2 className="text-sm font-medium opacity-70">Saved</h2>
        <div className="relative w-full min-h-[420px] rounded-2xl border bg-white overflow-hidden">
          {items.map((it) => (
            <div
              key={it.id}
              className="absolute rounded-xl overflow-hidden shadow border"
              style={{
                width: it.w,
                height: it.h,
                transform: `translate(${it.x || 0}px, ${it.y || 0}px)`,
              }}
            >
              <img
                src={it.url}
                alt={it.fileName || ""}
                className="block w-full h-full object-cover"
                draggable={false}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
