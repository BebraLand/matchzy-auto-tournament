import { useLayoutEffect, useRef } from 'react';

/** Fit a single line inside its layout box, keeping short names at the design's font size. */
export function AutoFitText({ text, fontSize, minScale = 0.5, fitHeight = false, fontKey = '' }: {
  text: string; fontSize: number; minScale?: number; fitHeight?: boolean; fontKey?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    const parent = node?.parentElement;
    if (!node || !parent) return;
    let disposed = false;
    const fit = () => {
      if (disposed) return;
      const style = window.getComputedStyle(parent);
      const width = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = parent.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (width <= 0 || fitHeight && height <= 0) return;
      // Measure intrinsic text width; scrollWidth on a 100%-wide span rounds away
      // fractional overflow and can still trigger an unwanted ellipsis.
      node.style.width = 'max-content';
      const fits = (size: number) => {
        node.style.fontSize = `${size}px`;
        return node.scrollWidth <= width - 1 && (!fitHeight || node.scrollHeight <= height);
      };
      if (!fits(fontSize)) {
        // Very long names stop shrinking at a readable size, then use CSS ellipsis.
        let low = fontSize * minScale;
        let high = fontSize;
        for (let i = 0; i < 10; i++) {
          const middle = (low + high) / 2;
          if (fits(middle)) low = middle;
          else high = middle;
        }
        node.style.fontSize = `${Math.floor(low * 10) / 10}px`;
      }
      node.style.width = '';
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    void document.fonts.ready.then(fit);
    document.fonts.addEventListener('loadingdone', fit);
    return () => { disposed = true; observer.disconnect(); document.fonts.removeEventListener('loadingdone', fit); };
  }, [text, fontSize, minScale, fitHeight, fontKey]);

  return <span ref={ref} className="vdc-fit-text" title={text} style={{ fontSize }}>{text}</span>;
}
