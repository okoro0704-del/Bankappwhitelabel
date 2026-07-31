import { useId, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

interface VerificationCodeInputProps {
  value: string;
  onChange: (digits: string) => void;
  disabled?: boolean;
  error?: string | null;
}

export function VerificationCodeInput({
  value,
  onChange,
  disabled = false,
  error,
}: VerificationCodeInputProps) {
  const id = useId();
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');

  function setDigit(index: number, char: string) {
    const next = value.split('');
    while (next.length < 6) next.push('');
    next[index] = char;
    const joined = next.join('').replace(/\D/g, '').slice(0, 6);
    onChange(joined);
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (value[index]) {
        setDigit(index, '');
      } else if (index > 0) {
        setDigit(index - 1, '');
        inputsRef.current[index - 1]?.focus();
      }
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight' && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    onChange(pasted);
    const focusIndex = Math.min(pasted.length, 5);
    inputsRef.current[focusIndex]?.focus();
  }

  return (
    <div className="field">
      <label className="field-label" id={`${id}-label`} htmlFor={`${id}-0`}>
        Verification code
      </label>
      <div
        className="xfer-code-grid"
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        {digits.map((digit, index) => (
          <input
            key={index}
            id={`${id}-${index}`}
            ref={(el) => {
              inputsRef.current[index] = el;
            }}
            className="xfer-code-input input"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            pattern="[0-9]*"
            maxLength={1}
            aria-label={`Digit ${index + 1} of 6`}
            disabled={disabled}
            value={digit.trim()}
            onChange={(event) => {
              const char = event.target.value.replace(/\D/g, '').slice(-1);
              setDigit(index, char);
              if (char && index < 5) {
                inputsRef.current[index + 1]?.focus();
              }
            }}
            onKeyDown={(event) => onKeyDown(index, event)}
            onPaste={onPaste}
            onFocus={(event) => event.target.select()}
          />
        ))}
      </div>
      {error ? (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : (
        <p className="field-hint">Enter the 6-digit code for this stage</p>
      )}
    </div>
  );
}
