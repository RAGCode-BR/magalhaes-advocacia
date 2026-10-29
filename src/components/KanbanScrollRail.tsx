import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Short fixed-size grip: compact and easy to spot, whatever the board width.
const THUMB_WIDTH = 72;
const STEP = 320;

/**
 * Always-visible horizontal scrollbar for the Kanban. macOS hides native
 * scrollbars until the user scrolls, so the board did not show that more
 * columns exist; this rail is drawn by us and looks the same on every system.
 * Thumb position is written straight to the DOM to keep scrolling smooth.
 */
export function KanbanScrollRail({ targetRef }: { targetRef: RefObject<HTMLDivElement | null> }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startScroll: number; ratio: number } | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const target = targetRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!target || !track || !thumb) return;

    const update = () => {
      const max = target.scrollWidth - target.clientWidth;
      const hasOverflow = max > 1;
      setOverflowing(hasOverflow);
      setAtStart(target.scrollLeft <= 1);
      setAtEnd(target.scrollLeft >= max - 1);
      if (!hasOverflow) return;
      const trackWidth = track.clientWidth;
      const thumbWidth = Math.min(trackWidth, THUMB_WIDTH);
      const x = (target.scrollLeft / max) * (trackWidth - thumbWidth);
      thumb.style.width = `${thumbWidth}px`;
      thumb.style.transform = `translateX(${x}px)`;
      track.setAttribute("aria-valuenow", String(Math.round((target.scrollLeft / max) * 100)));
    };

    update();
    target.addEventListener("scroll", update, { passive: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(target);
    resizeObserver.observe(track);
    if (target.firstElementChild) resizeObserver.observe(target.firstElementChild);
    return () => {
      target.removeEventListener("scroll", update);
      resizeObserver.disconnect();
    };
  }, [targetRef]);

  const scrollByStep = (direction: 1 | -1) => {
    targetRef.current?.scrollBy({ left: direction * STEP, behavior: "smooth" });
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    const target = targetRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!target || !track || !thumb || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const max = target.scrollWidth - target.clientWidth;
    const room = Math.max(1, track.clientWidth - thumb.offsetWidth);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startScroll: target.scrollLeft, ratio: max / room };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const target = targetRef.current;
    if (!drag || !target || drag.pointerId !== event.pointerId) return;
    target.scrollLeft = drag.startScroll + (event.clientX - drag.startX) * drag.ratio;
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

  const arrowClass =
    "kanban-rail-button grid h-5 w-5 shrink-0 place-items-center rounded-full transition disabled:pointer-events-none disabled:opacity-35 active:scale-90";

  return (
    <div
      className={`shrink-0 overflow-hidden px-3 transition-[height,opacity] duration-300 sm:px-4 ${overflowing ? "h-6 opacity-100" : "h-0 opacity-0"}`}
      aria-hidden={!overflowing}
    >
      <div className="flex h-6 items-center gap-1.5">
        <button
          type="button"
          className={arrowClass}
          onClick={() => scrollByStep(-1)}
          disabled={atStart}
          aria-label="Ver colunas à esquerda"
          title="Ver colunas à esquerda"
          tabIndex={overflowing ? 0 : -1}
        >
          <ChevronLeft className="h-3 w-3" />
        </button>
        <div
          ref={trackRef}
          className="kanban-rail-track relative h-1.5 min-w-0 flex-1 rounded-full"
          role="scrollbar"
          aria-orientation="horizontal"
          aria-label="Rolagem horizontal do Kanban"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
        >
          <div
            ref={thumbRef}
            className={`kanban-rail-thumb absolute inset-y-0 left-0 cursor-grab touch-none rounded-full ${dragging ? "is-dragging cursor-grabbing" : ""}`}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            title="Arraste para ver as outras colunas"
          />
        </div>
        <button
          type="button"
          className={arrowClass}
          onClick={() => scrollByStep(1)}
          disabled={atEnd}
          aria-label="Ver colunas à direita"
          title="Ver colunas à direita"
          tabIndex={overflowing ? 0 : -1}
        >
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
