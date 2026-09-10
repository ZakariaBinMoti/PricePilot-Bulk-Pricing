import { useId, useMemo, useRef, useState } from "react";
import type { FilterOption } from "../services/product-filter.server";
import type { ProductCondition } from "../services/product-conditions";
import styles from "./searchable-condition-value.module.css";

interface Props {
  condition: ProductCondition;
  options: FilterOption[];
  fieldLabel: string;
  index: number;
  onChange: (value: string, label?: string) => void;
}

/** An inline combobox: no portal, focus trap, or overlay-positioning lifecycle. */
export function SearchableConditionValue({
  condition,
  options,
  fieldLabel,
  index,
  onChange,
}: Props) {
  const [text, setText] = useState(condition.label ?? condition.value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const listId = `${id}-options`;
  const searchableOptions = useMemo(
    () =>
      options.map((option) => ({
        ...option,
        searchLabel: option.label.toLocaleLowerCase(),
      })),
    [options],
  );
  const matches = useMemo(() => {
    const search = text.toLocaleLowerCase();
    const result: FilterOption[] = [];
    for (const option of searchableOptions) {
      if (option.searchLabel.includes(search)) result.push(option);
      if (result.length > 100) break;
    }
    return result;
  }, [searchableOptions, text]);
  const visibleOptions = matches.slice(0, 100);
  const activeOption = visibleOptions[activeIndex];

  function select(option: FilterOption) {
    setText(option.label);
    setOpen(false);
    setActiveIndex(-1);
    onChange(option.value, option.label);
  }

  function changeText(value: string) {
    setText(value);
    setOpen(true);
    setActiveIndex(-1);
    const exact = searchableOptions.find(
      (option) => option.searchLabel === value.toLocaleLowerCase(),
    );
    // Preserve partial text locally; only a valid option becomes the filter value.
    onChange(exact?.value ?? "", exact?.label);
  }

  return (
    <div className={styles.root}>
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label={`Condition ${index + 1} ${fieldLabel.toLowerCase()} value`}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && activeOption ? `${listId}-${activeIndex}` : undefined
        }
        autoComplete="off"
        placeholder={`Search ${fieldLabel.toLowerCase()}…`}
        value={text}
        style={{ paddingRight: 32 }}
        onChange={(event) => changeText(event.target.value)}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActiveIndex(-1);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            if (!visibleOptions.length) return;
            const next =
              event.key === "ArrowDown"
                ? (activeIndex + 1) % visibleOptions.length
                : activeIndex <= 0
                  ? visibleOptions.length - 1
                  : activeIndex - 1;
            setActiveIndex(next);
            input.current?.ownerDocument
              .getElementById(`${listId}-${next}`)
              ?.scrollIntoView?.({ block: "nearest" });
          } else if (event.key === "Enter" && open && activeOption) {
            event.preventDefault();
            select(activeOption);
          } else if (event.key === "Escape") {
            setOpen(false);
            setActiveIndex(-1);
          } else if (event.key === "Tab") {
            setOpen(false);
            setActiveIndex(-1);
          }
        }}
      />
      {text && (
        <button
          type="button"
          className={styles.clear}
          tabIndex={-1}
          aria-label={`Clear ${fieldLabel.toLowerCase()} value`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            changeText("");
            input.current?.focus();
          }}
        >
          ×
        </button>
      )}
      {open && (
        <div className={styles.dropdown}>
          <div className={styles.heading}>
            {matches.length > 100
              ? "First 100 matches — keep typing to narrow"
              : `Available ${fieldLabel.toLowerCase()} values`}
          </div>
          <ul
            id={listId}
            role="listbox"
            aria-label={`${fieldLabel} options`}
            className={styles.options}
          >
            {visibleOptions.map((option, optionIndex) => (
              <li
                key={option.value}
                role="option"
                id={`${listId}-${optionIndex}`}
                aria-selected={condition.value === option.value}
                className={`${styles.option} ${activeIndex === optionIndex ? styles.active : ""}`}
                onPointerDown={(event) => event.preventDefault()}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(option)}
                onMouseMove={() => setActiveIndex(optionIndex)}
              >
                {option.label}
              </li>
            ))}
          </ul>
          {!matches.length && (
            <div role="status" className={styles.empty}>
              No matching {fieldLabel.toLowerCase()} values
            </div>
          )}
        </div>
      )}
    </div>
  );
}
