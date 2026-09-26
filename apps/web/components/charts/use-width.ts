'use client';
import { useEffect, useRef, useState } from 'react';

/** Width of a container, tracked with ResizeObserver (charts render at their real pixel width). */
export function useWidth<T extends HTMLElement>(initial = 640, min = 260) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(min, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
