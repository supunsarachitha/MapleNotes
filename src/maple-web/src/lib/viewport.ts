import { useEffect, useState, type RefObject } from "react";

/**
 * Whether an element has come within `margin` of the viewport. Once it has, the answer stays true, so whatever it
 * started (loading a picture, a player or a preview) is not undone by scrolling past. Browsers without
 * IntersectionObserver get true at once.
 */
export function useNearViewport(ref: RefObject<Element | null>, margin = "800px"): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const element = ref.current;
    if (near || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: `${margin} 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, margin, near]);

  return near;
}
