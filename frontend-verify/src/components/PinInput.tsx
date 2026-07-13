// VibeNet — segmented PIN input: N individual single-digit boxes with
// auto-advancing focus, backspace-to-previous, and full-code paste. Controlled
// via `value` / `onChange` so a parent owns the string; `onComplete` fires when
// all boxes are filled. Used by the Chat-PIN settings panel (masked) and the
// chat-start verification dialog.

'use client';

import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

export function PinInput({
  value,
  onChange,
  onComplete,
  length = 6,
  masked = false,
  autoFocus = false,
  disabled = false,
  hasError = false,
  ariaLabel = 'PIN',
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  length?: number;
  masked?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  hasError?: boolean;
  ariaLabel?: string;
}) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus();
  }, [autoFocus]);

  const digits = value.split('').slice(0, length);

  function setAt(index: number, digit: string) {
    const next = value.split('');
    next[index] = digit;
    // Trim trailing empties and cap at length.
    const joined = next.join('').replace(/\D/g, '').slice(0, length);
    onChange(joined);
    if (joined.length === length) onComplete?.(joined);
  }

  function handleChange(index: number, raw: string) {
    const digit = raw.replace(/\D/g, '');
    if (!digit) return;
    // Take the last typed character so overtyping a filled box advances cleanly.
    setAt(index, digit[digit.length - 1]);
    if (index < length - 1) inputs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (value[index]) {
        setAt(index, '');
      } else if (index > 0) {
        setAt(index - 1, '');
        inputs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      inputs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    onChange(pasted);
    if (pasted.length === length) onComplete?.(pasted);
    // Focus the next empty box (or the last one when full).
    const target = Math.min(pasted.length, length - 1);
    inputs.current[target]?.focus();
  }

  return (
    <div className="flex justify-center gap-2 sm:gap-2.5" role="group" aria-label={ariaLabel}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            inputs.current[i] = el;
          }}
          type={masked ? 'password' : 'text'}
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]*"
          maxLength={1}
          disabled={disabled}
          aria-label={`${ariaLabel} digit ${i + 1}`}
          value={digits[i] ?? ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={[
            'h-12 w-10 rounded-xl border text-center text-lg font-semibold sm:h-14 sm:w-12 sm:text-xl',
            'bg-white/80 text-gray-900 shadow-sm outline-none transition-colors duration-300 ease-in-out',
            'dark:bg-gray-950/60 dark:text-white',
            'focus:border-[color:var(--vibe-blue)] focus:ring-2 focus:ring-[color:var(--vibe-blue)]/40',
            'disabled:cursor-not-allowed disabled:opacity-60',
            hasError
              ? 'border-red-400 ring-2 ring-red-400/30 dark:border-red-500'
              : 'border-gray-200 dark:border-gray-700',
          ].join(' ')}
        />
      ))}
    </div>
  );
}
