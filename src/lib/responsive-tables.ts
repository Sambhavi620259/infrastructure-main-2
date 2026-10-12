"use client";

import { useEffect } from "react";

/**
 * On phones, tables inside the app are shown as cards (see `.app-main table`
 * in globals.css). Each card cell shows its column name, which comes from a
 * `data-label` attribute. This copies the <th> text onto every <td> so no
 * table needs to set it by hand, and keeps doing so as rows load.
 */
function labelTables(root: HTMLElement) {
  for (const table of root.querySelectorAll("table")) {
    const headings = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
    if (headings.length === 0) continue;
    for (const row of table.querySelectorAll("tbody tr")) {
      let column = 0;
      for (const cell of Array.from(row.children) as HTMLTableCellElement[]) {
        const label = headings[column] ?? "";
        if (label && cell.colSpan === 1) {
          if (cell.dataset.label !== label) cell.dataset.label = label;
        } else if (cell.dataset.label) {
          delete cell.dataset.label;
        }
        column += cell.colSpan || 1;
      }
    }
  }
}

/** Pass the element via a callback ref (useState), so this runs once it exists. */
export function useResponsiveTables(root: HTMLElement | null) {
  useEffect(() => {
    if (!root) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => labelTables(root));
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [root]);
}
