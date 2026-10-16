import { useEffect, useState } from "react";
import { previewUrl } from "@/data/catalog";
import { getThumbnailService } from "./ThumbnailService";

/**
 * Returns the runtime thumbnail URL for a model id, or null while it's still rendering.
 * Returning null (rather than the low-res PNG) lets consumers skip rendering an img until
 * the crisp version is ready, which avoids the visible PNG→data-URL swap flicker.
 */
export function useThumbnail(id: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    getThumbnailService()
      .getThumbnail(id)
      .then((data) => {
        if (!alive) return;
        if (data && data.length > 200) setUrl(data);
        else setUrl(previewUrl(id));
      })
      .catch(() => {
        if (alive) setUrl(previewUrl(id));
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return url;
}
