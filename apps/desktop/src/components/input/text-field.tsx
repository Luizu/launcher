import { useId } from "react";

export interface TextFieldProps {
  label: string;
  type?: "email" | "password" | "text";
  autoComplete?: string;
  required?: boolean;
  /** Optional hint text inside the field (e.g. "Buscar na biblioteca"). */
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * Labeled text input. Every field is associated with its label through a
 * generated id, so assistive technology announces it without extra wiring.
 */
export function TextField({
  label,
  type = "text",
  autoComplete,
  required = false,
  placeholder,
  value,
  onChange,
}: TextFieldProps) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-zinc-300">
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400"
      />
    </div>
  );
}
