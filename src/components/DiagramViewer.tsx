import { useState, useEffect, useCallback } from "react";

interface Props {
  src: string;
  alt: string;
  caption?: string;
}

export default function DiagramViewer({ src, alt, caption }: Props) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  return (
    <>
      {/* Inline thumbnail with expand button */}
      <figure
        style={{
          margin: "1.5rem 0",
          position: "relative",
          cursor: "zoom-in",
        }}
        onClick={() => setOpen(true)}
      >
        <img
          src={src}
          alt={alt}
          style={{
            width: "100%",
            borderRadius: "8px",
            border: "1px solid rgba(128,128,128,0.2)",
            transition: "opacity 0.2s",
          }}
          onMouseEnter={e =>
            ((e.target as HTMLImageElement).style.opacity = "0.9")
          }
          onMouseLeave={e =>
            ((e.target as HTMLImageElement).style.opacity = "1")
          }
        />

        {/* Expand badge */}
        <button
          aria-label="View fullscreen"
          onClick={e => {
            e.stopPropagation();
            setOpen(true);
          }}
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(6px)",
            border: "none",
            borderRadius: "6px",
            color: "#fff",
            padding: "5px 10px",
            fontSize: "12px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "5px",
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
          Expand
        </button>

        {caption && (
          <figcaption
            style={{
              textAlign: "center",
              fontSize: "0.85rem",
              color: "var(--color-text-muted, #888)",
              marginTop: "0.5rem",
              fontStyle: "italic",
            }}
          >
            {caption}
          </figcaption>
        )}
      </figure>

      {/* Lightbox overlay */}
      {open && (
        <div
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.88)",
            backdropFilter: "blur(4px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          {/* Close button */}
          <button
            aria-label="Close fullscreen"
            onClick={close}
            style={{
              position: "absolute",
              top: "16px",
              right: "20px",
              background: "rgba(255,255,255,0.12)",
              border: "none",
              borderRadius: "8px",
              color: "#fff",
              padding: "8px 14px",
              fontSize: "13px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Close (Esc)
          </button>

          {/* Full-size image — stop propagation so clicking the image doesn't close */}
          <img
            src={src}
            alt={alt}
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: "95vw",
              maxHeight: "90vh",
              objectFit: "contain",
              borderRadius: "8px",
              boxShadow: "0 8px 48px rgba(0,0,0,0.6)",
            }}
          />

          {caption && (
            <p
              style={{
                color: "rgba(255,255,255,0.6)",
                fontSize: "0.82rem",
                marginTop: "12px",
                fontStyle: "italic",
              }}
            >
              {caption}
            </p>
          )}
        </div>
      )}
    </>
  );
}
