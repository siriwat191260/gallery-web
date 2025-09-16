// ---- 5) Upload component (preview first, save on click) ----
type PendingFile = {
  file: File;
  previewUrl: string;
  w?: number;
  h?: number;
};

const Uploader: React.FC<{ onUploaded?: () => void }> = ({ onUploaded }) => {
  const { db, storage } = ensureFirebase();
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // cleanup object URLs
  useEffect(() => {
    return () => {
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (!files.length) return;

    // build previews + read dims (optional)
    const entries: PendingFile[] = [];
    for (const f of files) {
      const previewUrl = URL.createObjectURL(f);
      const dims = await readImageDims(f); // from your helpers
      entries.push({ file: f, previewUrl, w: dims?.w, h: dims?.h });
    }

    setPending((prev) => [...prev, ...entries]);

    // reset input so user can pick same file again later if needed
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeOne = (idx: number) => {
    setPending((prev) => {
      const copy = [...prev];
      const [removed] = copy.splice(idx, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return copy;
    });
  };

  const onSave = async () => {
    if (!pending.length) return;
    setIsSaving(true);
    try {
      for (const p of pending) {
        // 1) Upload to Storage
        const key = `galleries/default/${Date.now()}_${p.file.name}`;
        const ref = storageRef(storage, key);
        await uploadBytes(ref, p.file, { contentType: p.file.type });
        const url = await getDownloadURL(ref);

        // 2) Write Firestore doc
        await addDoc(collection(db, "galleries", "default", "items"), {
          url,
          fileName: p.file.name,
          w: p.w,
          h: p.h,
          createdAt: serverTimestamp(),
        });
      }

      // clear selection after successful save
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPending([]);
      onUploaded?.();
    } finally {
      setIsSaving(false);
    }
  };

  const canSave = pending.length > 0 && !isSaving;

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Controls */}
      <div className="flex items-center gap-3">
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

        <button
          onClick={onSave}
          disabled={!canSave}
          className={[
            "px-4 py-2 rounded-2xl border shadow",
            canSave ? "hover:shadow-md" : "opacity-50 cursor-not-allowed",
          ].join(" ")}
        >
          {isSaving
            ? "Saving…"
            : `Save ${pending.length ? `(${pending.length})` : ""}`}
        </button>
      </div>

      {/* Preview grid */}
      {pending.length > 0 && (
        <div className="border rounded-2xl p-3">
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            }}
          >
            {pending.map((p, idx) => (
              <figure
                key={idx}
                className="relative rounded-xl overflow-hidden border bg-white"
              >
                <img
                  src={p.previewUrl}
                  alt={p.file.name}
                  className="block w-full h-[140px] object-cover"
                />
                <figcaption className="p-2 text-[11px] truncate">
                  {p.file.name}
                </figcaption>
                <button
                  type="button"
                  onClick={() => removeOne(idx)}
                  className="absolute top-1 right-1 text-xs rounded-md px-2 py-1 bg-black/60 text-white"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </figure>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
