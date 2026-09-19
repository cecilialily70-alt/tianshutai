import Draggable from 'react-draggable';

export default function DraggablePanel({
  title,
  onClose,
  widthClass = 'w-[420px]',
  children,
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <Draggable
        handle=".panel-drag-handle"
        cancel=".panel-close"
        defaultPosition={{ x: 96, y: 72 }}
        bounds="parent"
      >
        <div
          className={`pointer-events-auto relative ${widthClass} rounded-xl border border-shell-line bg-shell-card shadow-2xl shadow-black/40`}
        >
          <div className="panel-drag-handle flex cursor-move select-none items-center justify-between border-b border-shell-line px-4 py-3">
            <div className="flex items-center gap-2">
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5 text-shell-muted"
                fill="currentColor"
                aria-hidden="true"
              >
                <circle cx="5" cy="3" r="1.2" />
                <circle cx="11" cy="3" r="1.2" />
                <circle cx="5" cy="8" r="1.2" />
                <circle cx="11" cy="8" r="1.2" />
                <circle cx="5" cy="13" r="1.2" />
                <circle cx="11" cy="13" r="1.2" />
              </svg>
              <h2 className="text-sm font-medium text-shell-text">{title}</h2>
            </div>
            <button
              type="button"
              className="panel-close flex h-7 w-7 items-center justify-center rounded-lg text-shell-muted transition hover:bg-shell-hover hover:text-shell-text"
              onClick={onClose}
            >
              ×
            </button>
          </div>
          <div className="max-h-[min(74vh,680px)] overflow-y-auto p-4">{children}</div>
        </div>
      </Draggable>
    </div>
  );
}
