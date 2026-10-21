import { useEffect, useRef, useState } from "react";
import { ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/** Observe the viewport before asking Storage for the image bytes. */
export function LazyAttachmentThumbnail({ path, name, initialSrc, className = "h-full w-full" }: {
  path: string; name: string; initialSrc?: string; className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "100px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setSrc(null);
    if (!visible || initialSrc) return;
    let active = true, url: string | null = null;
    void supabase.storage.from("task-attachments").download(path).then(({ data, error }: { data: Blob | null; error: unknown }) => {
      if (!active || error || !data) return;
      url = URL.createObjectURL(data); setSrc(url);
    }).catch(() => {});
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [path, visible, initialSrc]);
  return <span ref={ref} className={`flex items-center justify-center ${className}`}>
    {initialSrc || src ? <img src={initialSrc || src!} alt={name} decoding="async" className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4 text-muted-foreground" />}
  </span>;
}
