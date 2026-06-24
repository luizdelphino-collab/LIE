/**
 * components/AutoResizeTextarea.tsx
 *
 * Textarea que cresce sozinho conforme o conteúdo — acaba com o problema dos
 * campos travados em 3 linhas. Em modo leitura, exibe o texto inteiro sem scroll.
 */

import { useEffect, useRef, type TextareaHTMLAttributes } from 'react';

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Altura mínima em linhas. */
  minRows?: number;
}

export default function AutoResizeTextarea({ minRows = 4, value, style, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      style={{ overflow: 'hidden', resize: 'none', ...style }}
      {...rest}
    />
  );
}
