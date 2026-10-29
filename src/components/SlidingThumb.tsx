import { motion } from "motion/react";

/**
 * Glass highlight of the selected option in a segmented control. Rendered only
 * inside the active option; options sharing a `layoutId` (inside the same
 * LayoutGroup) make it slide from the previous choice to the new one.
 */
export function SlidingThumb({
  layoutId,
  className = "rounded-full",
}: {
  layoutId: string;
  className?: string;
}) {
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden="true"
      className={`glass-thumb absolute inset-0 ${className}`}
      transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
    />
  );
}
