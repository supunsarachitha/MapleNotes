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

export interface VisibleArea {
  top: number;
  height: number;
}

/**
 * While `active`, the part of the page the user can see (`window.visualViewport`), which on phones excludes the
 * on-screen keyboard. Full-screen panels size themselves to it so their bottom row is not hidden behind the
 * keyboard in browsers that keep the layout full height when it opens (iOS Safari, Chrome before
 * `interactive-widget`). Null when inactive or unsupported, so callers keep their CSS-only layout.
 */
export function useVisibleArea(active: boolean): VisibleArea | null {
  const [area, setArea] = useState<VisibleArea | null>(null);

  useEffect(() => {
    const viewport = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!active || !viewport) {
      setArea(null);
      return;
    }
    const update = () =>
      setArea((current) =>
        current && current.top === viewport.offsetTop && current.height === viewport.height
          ? current
          : { top: viewport.offsetTop, height: viewport.height },
      );
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [active]);

  return active ? area : null;
}
