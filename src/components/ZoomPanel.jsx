import DraggablePanel from './DraggablePanel.jsx';

const PRESETS = [0.75, 1, 1.25, 1.5];

export default function ZoomPanel({ tab, onClose, onChange }) {
  const value = tab.zoomFactor || 1;

  return (
    <DraggablePanel title={`缩放页面 · ${tab.name}`} onClose={onClose} widthClass="w-[360px]">
      <div className="space-y-4 text-sm">
        <div className="flex items-center justify-between text-shell-muted">
          <span>当前缩放</span>
          <span className="text-shell-text">{Math.round(value * 100)}%</span>
        </div>
        <input
          type="range"
          min="50"
          max="200"
          step="5"
          value={Math.round(value * 100)}
          onChange={(event) => onChange(tab.id, Number(event.target.value) / 100)}
          className="w-full accent-[#25D366]"
        />
        <div className="flex gap-2">
          {PRESETS.map((factor) => (
            <button
              key={factor}
              type="button"
              onClick={() => onChange(tab.id, factor)}
              className={`flex-1 rounded-lg border px-2 py-1.5 transition ${
                value === factor
                  ? 'border-shell-wa bg-[#005c4b] text-white'
                  : 'border-shell-line bg-[#111b21] text-shell-muted hover:text-shell-text'
              }`}
            >
              {Math.round(factor * 100)}%
            </button>
          ))}
        </div>
      </div>
    </DraggablePanel>
  );
}
