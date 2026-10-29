import { AnimatePresence, motion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export const TOP_NAV_ITEM_CLASS =
  "relative flex h-9 shrink-0 items-center rounded-full px-2.5 text-sm text-sidebar-foreground/75 outline-none transition-colors hover:bg-white/10 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";

const PILL_SPRING = { type: "spring", bounce: 0.18, duration: 0.45 } as const;

/**
 * Visual content of one item of the top navigation bar. The active item owns a
 * glass pill shared through `layoutId`, so it slides between items, and shows
 * its label; the others stay icon-only to leave room for the page.
 */
export function TopNavItemContent({
  active,
  icon: Icon,
  label,
  badge,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  badge?: ReactNode;
}) {
  return (
    <>
      {active && (
        <motion.span
          layoutId="top-nav-pill"
          className="topnav-pill absolute inset-0 rounded-full"
          transition={PILL_SPRING}
        />
      )}
      <Icon className={`relative h-4 w-4 shrink-0 ${active ? "text-sidebar-primary" : ""}`} />
      <AnimatePresence initial={false}>
        {active && (
          <motion.span
            key="label"
            className="relative overflow-hidden whitespace-nowrap font-medium text-sidebar-foreground"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: "auto", opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={PILL_SPRING}
          >
            <span className="block pl-2 pr-0.5">{label}</span>
          </motion.span>
        )}
      </AnimatePresence>
      {!active && <span className="sr-only">{label}</span>}
      {badge}
    </>
  );
}

export function TopNavBadge({ count, tone = "alert" }: { count: number; tone?: "alert" | "info" }) {
  if (count <= 0) return null;
  return (
    <span
      className={`absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold leading-none text-white shadow-sm ring-2 ring-[#4a1418] ${tone === "alert" ? "bg-red-500" : "bg-[#142e63]"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
