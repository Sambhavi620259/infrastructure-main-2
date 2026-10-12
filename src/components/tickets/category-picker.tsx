"use client";

import { createAssetCategory, type AssetCategory } from "@/lib/tickets";

const NEW = "__new__";

/**
 * Category dropdown for ticket forms. The last option, "Add a new category…",
 * reveals a name field; the form creates that category when it submits (see
 * resolveCategoryId), so there is no separate Add step to forget.
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  draft,
  onDraftChange,
  selectClassName,
}: {
  categories: AssetCategory[];
  value: string;
  onChange: (categoryId: string) => void;
  draft: string | null;
  onDraftChange: (name: string | null) => void;
  selectClassName: string;
}) {
  return (
    <span className="block">
      <select
        value={draft !== null ? NEW : value}
        onChange={(event) => {
          if (event.target.value === NEW) {
            onChange("");
            onDraftChange("");
          } else {
            onDraftChange(null);
            onChange(event.target.value);
          }
        }}
        className={selectClassName}
      >
        <option value="">Choose a category…</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
        <option value={NEW}>+ Add a new category…</option>
      </select>
      {draft !== null && (
        <input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          autoFocus
          maxLength={100}
          placeholder="New category name, e.g. Docking Station"
          aria-label="New category name"
          className={selectClassName}
        />
      )}
    </span>
  );
}

/**
 * The category to submit: the selected one, or the typed new name (reusing an
 * existing category of the same name, otherwise creating it). Returns "" when
 * nothing was chosen.
 */
export async function resolveCategoryId(
  categories: AssetCategory[],
  selectedId: string,
  draft: string | null,
  onCreated: (category: AssetCategory) => void,
): Promise<string> {
  if (draft === null) return selectedId;
  const name = draft.trim();
  if (!name) return "";
  const existing = categories.find((category) => category.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const created = await createAssetCategory(name);
  onCreated(created);
  return created.id;
}
