import { useEffect, useRef, useState } from 'react';

export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  badgeColor?: 'violet' | 'emerald' | 'amber' | 'blue' | 'zinc';
  icon?: React.ReactNode;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  align?: 'left' | 'right';
}

const badgeColorMap: Record<string, string> = {
  violet: 'bg-sky-100 text-sky-800 border-sky-200',
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  blue: 'bg-blue-100 text-blue-800 border-blue-200',
  zinc: 'bg-slate-100 text-slate-700 border-slate-200',
};

export function Dropdown({
  options,
  value,
  onChange,
  disabled = false,
  placeholder = 'Select an option',
  className = '',
  buttonClassName = '',
  menuClassName = '',
  align = 'left',
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!isOpen) return;
      if (event.key === 'Escape') {
        setIsOpen(false);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        const currentIndex = options.findIndex((opt) => opt.value === value);
        const nextIndex = (currentIndex + 1) % options.length;
        if (options[nextIndex]) onChange(options[nextIndex].value);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const currentIndex = options.findIndex((opt) => opt.value === value);
        const prevIndex = (currentIndex - 1 + options.length) % options.length;
        if (options[prevIndex]) onChange(options[prevIndex].value);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, options, value, onChange]);

  return (
    <div className={`relative inline-block text-left ${className}`} ref={containerRef}>
      <button
        type="button"
        disabled={disabled || options.length === 0}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`group flex items-center justify-between gap-3 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-900 shadow-sm transition-all duration-200 hover:border-sky-300 hover:bg-sky-50 focus:border-sky-600 focus:outline-none focus:ring-4 focus:ring-sky-500/15 disabled:cursor-not-allowed disabled:opacity-50 ${buttonClassName}`}
      >
        <div className="flex items-center gap-2.5 min-w-0 truncate">
          {selectedOption?.badge && (
            <span
              className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                badgeColorMap[selectedOption.badgeColor || 'violet']
              }`}
            >
              {selectedOption.badge}
            </span>
          )}
          {selectedOption?.icon && <span className="shrink-0">{selectedOption.icon}</span>}
          <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        </div>

        <svg
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 group-hover:text-sky-700 ${
            isOpen ? 'rotate-180 text-sky-700' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          role="listbox"
          tabIndex={-1}
          className={`absolute ${
            align === 'right' ? 'right-0' : 'left-0'
          } mt-2 w-full min-w-[240px] max-w-sm rounded-xl border border-slate-300 bg-white p-1.5 shadow-xl shadow-slate-400/25 z-50 animate-in fade-in zoom-in-95 duration-150 ${menuClassName}`}
        >
          <div className="max-h-60 overflow-y-auto space-y-1">
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`group flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all duration-150 ${
                    isSelected
                      ? 'bg-sky-100 text-sky-950 font-semibold border border-sky-300'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {option.badge && (
                      <span
                        className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                          badgeColorMap[option.badgeColor || 'violet']
                        }`}
                      >
                        {option.badge}
                      </span>
                    )}
                    {option.icon && <span className="shrink-0">{option.icon}</span>}
                    <div className="min-w-0">
                      <div className="truncate text-sm">{option.label}</div>
                      {option.description && (
                        <div className="text-xs text-slate-500 truncate">{option.description}</div>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <svg
                      className="h-4 w-4 shrink-0 text-sky-700"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
