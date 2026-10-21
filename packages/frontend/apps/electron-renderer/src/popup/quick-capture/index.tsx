import { apis, events } from '@nota/electron-api';
import { useCallback, useEffect, useRef, useState } from 'react';

import * as styles from './styles.css';

const isMac = environment.isMacOs;

export function QuickCapture() {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    return events?.quickCapture.onShown(() => {
      setSaving(false);
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const close = useCallback(() => {
    apis?.quickCapture.hide().catch(console.error);
  }, []);

  const save = useCallback(async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      const saved = await apis?.quickCapture.submit(text);
      if (saved) setText('');
    } catch (error) {
      console.error('Failed to save quick note', error);
    } finally {
      setSaving(false);
    }
  }, [saving, text]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        save().catch(console.error);
      }
    },
    [close, save]
  );

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.title}>Quick note</span>
          <span className={styles.hint}>Saves to today’s journal</span>
        </div>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={text}
          placeholder="Write a thought, a link, or “[] a task”…"
          spellCheck
          onChange={event => setText(event.target.value)}
          onKeyDown={onKeyDown}
          data-testid="quick-capture-input"
        />
        <div className={styles.footer}>
          <span className={styles.keys}>
            Enter to save · Shift+Enter for a new line · Esc to close
          </span>
          <button
            type="button"
            className={styles.saveButton}
            disabled={!text.trim() || saving}
            onClick={() => {
              save().catch(console.error);
            }}
          >
            {isMac ? 'Save ↩' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
