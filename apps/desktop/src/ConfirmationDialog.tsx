export function ConfirmationDialog({
  cancelLabel,
  confirmLabel,
  description,
  eyebrow,
  onCancel,
  onConfirm,
  title,
  tone = "default",
}: {
  cancelLabel: string;
  confirmLabel: string;
  description: string;
  eyebrow: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  tone?: "danger" | "default";
}) {
  return (
    <div className="settings-backdrop confirmation-backdrop" role="presentation">
      <section
        aria-label={title}
        aria-modal="true"
        className={`confirmation-dialog ${tone}`}
        role="dialog"
      >
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
        <div className="confirmation-actions">
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button
            className={tone === "danger" ? "danger-confirm" : "primary-confirm"}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
