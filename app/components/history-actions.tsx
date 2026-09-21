import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { Icon } from "@shopify/polaris";
import { MenuVerticalIcon } from "@shopify/polaris-icons";
import { readJobCampaignName } from "../services/job-configuration";
import styles from "./history-actions.module.css";

type HistoryJob = {
  id: string;
  filters: string;
  status: string;
  isScheduled: boolean;
  scheduleStatus?: string | null;
};

export function HistoryActions({
  job,
  onDelete,
}: {
  job: HistoryJob;
  onDelete: (job: HistoryJob) => void;
}) {
  const campaignName = readJobCampaignName(job.filters);
  const canDelete = ["completed", "failed", "rolled_back", "cancelled"].includes(job.status) &&
    (!job.isScheduled || ["completed", "cancelled"].includes(job.scheduleStatus || ""));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const closeMenu = () => setMenuPosition(null);

  const toggleMenu = () => {
    if (menuPosition) {
      closeMenu();
      return;
    }

    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const menuWidth = 176;
    const menuHeight = 124;
    const gap = 6;
    const viewportPadding = 8;
    const openAbove = rect.bottom + gap + menuHeight > window.innerHeight;

    setMenuPosition({
      top: openAbove ? rect.top - menuHeight - gap : rect.bottom + gap,
      left: Math.min(
        window.innerWidth - menuWidth - viewportPadding,
        Math.max(viewportPadding, rect.right - menuWidth),
      ),
    });
  };

  useEffect(() => {
    if (!menuPosition) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [menuPosition]);

  return (
    <div className={styles.menu}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.menuTrigger}
        aria-label={`Actions for ${campaignName || "this adjustment"}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(menuPosition)}
        title="Actions"
        onClick={toggleMenu}
      >
        <Icon source={MenuVerticalIcon} />
      </button>
      {menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            className={styles.menuItems}
            role="menu"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            <Link
              className={styles.menuItem}
              role="menuitem"
              to={`/app/history/${job.id}`}
              onClick={closeMenu}
            >
              View details
            </Link>
            <Link
              className={styles.menuItem}
              role="menuitem"
              to={`/app/history/${job.id}?editCampaign=1`}
              onClick={closeMenu}
            >
              {campaignName ? "Rename campaign" : "Name campaign"}
            </Link>
            <button
              type="button"
              className={`${styles.menuItem} ${styles.dangerMenuItem}`}
              role="menuitem"
              disabled={!canDelete}
              title={canDelete ? "Delete adjustment" : "Active adjustments and pending auto-reverts cannot be deleted"}
              onClick={() => {
                closeMenu();
                onDelete(job);
              }}
            >
              Delete adjustment
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
