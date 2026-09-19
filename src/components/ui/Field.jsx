export default function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs tracking-wide text-shell-muted">{label}</span>
      {children}
    </label>
  );
}

export function DarkSelect({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-shell-line bg-[#111b21] px-3 py-2.5 text-sm text-shell-text outline-none transition focus:border-shell-accent"
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function DarkInput({ value, onChange, placeholder, type = 'text', onBlur, maxLength }) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onBlur={onBlur}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-shell-line bg-[#111b21] px-3 py-2.5 text-sm text-shell-text outline-none transition focus:border-shell-accent"
    />
  );
}
