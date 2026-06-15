import { startTransition, useEffect, useRef, useState } from "react";

export type PopupSelectOption = {
  description?: string;
  group?: string;
  label: string;
  tone?: "danger";
  value: string;
};

export const MIMO_MODEL_OPTIONS: PopupSelectOption[] = [
  { value: "mimo-v2.5", label: "mimo-v2.5", description: "默认模型，适合日常编程任务" },
  {
    value: "mimo-v2.5-pro",
    label: "mimo-v2.5-pro",
    description: "复杂任务与更深推理",
    group: "高级模型",
  },
];

export const SANDBOX_OPTIONS: PopupSelectOption[] = [
  { value: "read-only", label: "只读", description: "仅检查项目，不修改文件" },
  { value: "workspace-write", label: "工作区写入", description: "可修改当前项目内的文件" },
  {
    value: "danger-full-access",
    label: "完全访问",
    description: "可访问项目外内容",
    group: "高风险权限",
    tone: "danger",
  },
];

export function PopupSelect({
  ariaLabel,
  className = "",
  label,
  onChange,
  options,
  placement = "bottom",
  value,
}: {
  ariaLabel: string;
  className?: string;
  label: string;
  onChange: (value: string) => void;
  options: PopupSelectOption[];
  placement?: "bottom" | "top";
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  let previousGroup: string | undefined;
  return (
    <div
      className={["popup-select", `popup-select-${placement}`, open ? "open" : "", className]
        .filter(Boolean)
        .join(" ")}
      ref={rootRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="popup-select-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span>
        <strong>{selected?.label ?? value}</strong>
      </button>
      <div
        aria-hidden={!open}
        aria-label={`${ariaLabel}选项`}
        className="popup-select-menu"
        role="listbox"
      >
        {options.map((option) => {
          const showGroup = option.group && option.group !== previousGroup;
          previousGroup = option.group;
          return (
            <div className="popup-select-option-group" key={option.value}>
              {showGroup && <div className="popup-select-group-label">{option.group}</div>}
              <button
                aria-selected={option.value === value}
                className={[option.value === value ? "selected" : "", option.tone ?? ""]
                  .filter(Boolean)
                  .join(" ")}
                role="option"
                tabIndex={open ? 0 : -1}
                type="button"
                onClick={() => {
                  setOpen(false);
                  startTransition(() => onChange(option.value));
                }}
              >
                <span className="popup-select-option-copy">
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
                <span aria-hidden="true" className="popup-select-check">✓</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
