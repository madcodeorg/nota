import {
  ArrowDownSmallIcon,
  ArrowUpSmallIcon,
  CloseIcon,
  SearchIcon,
} from '@blocksuite/icons/rc';
import { IconButton, observeResize, RowInput, toast } from '@nota/component';
import { activeDocEditor$ } from '@nota/core/components/root-app-sidebar/ai-panel-slot';
import { FindInPageService } from '@nota/core/modules/find-in-page';
import { useLiveData, useService } from '@nota/infra';
import * as Popover from '@radix-ui/react-popover';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import clsx from 'clsx';
import {
  type CompositionEventHandler,
  type KeyboardEventHandler,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { RiFindReplaceLine } from 'react-icons/ri';
import { useTransitionState } from 'react-transition-state';

import * as styles from './find-in-page-popup.css';
import {
  findTextMatchesInDoc,
  replaceAllInDoc,
  replaceMatchInDoc,
} from './replace-in-doc';

const animationTimeout = 120;

const drawText = (
  canvas: HTMLCanvasElement,
  text: string,
  scrollLeft: number
) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  // the container will be animated,
  // so we need to use clientWidth and clientHeight instead of getBoundingClientRect
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;

  const rootStyles = getComputedStyle(document.documentElement);
  const textColor = rootStyles
    .getPropertyValue('--affine-text-primary-color')
    .trim();

  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const offsetX = -scrollLeft;
  ctx.fillStyle = textColor;
  ctx.font = '15px Inter';
  ctx.letterSpacing = '0.01em';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, offsetX, 22);
};

const CanvasText = ({
  text,
  scrollLeft,
  className,
}: {
  text: string;
  scrollLeft: number;
  className: string;
}) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) {
      return;
    }
    drawText(canvas, text, scrollLeft);
    return observeResize(canvas, () => drawText(canvas, text, scrollLeft));
  }, [text, scrollLeft]);

  return <canvas className={className} ref={ref} />;
};

export const FindInPagePopup = () => {
  const [value, setValue] = useState('');
  const [replaceValue, setReplaceValue] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);

  const findInPage = useService(FindInPageService).findInPage;
  const visible = useLiveData(findInPage.visible$);
  const result = useLiveData(findInPage.result$);
  const isSearching = useLiveData(findInPage.isSearching$);
  const activeEditor = useLiveData(activeDocEditor$);
  const activeDoc = activeEditor?.doc ?? null;
  const canReplace = !!activeDoc && !activeDoc.readonly && value.length > 0;

  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [composing, setComposing] = useState(false);

  const [{ status }, toggle] = useTransitionState({
    timeout: animationTimeout,
  });

  useEffect(() => {
    toggle(visible);
    setValue(findInPage.searchText$.value || '');
  }, [findInPage.searchText$.value, toggle, visible]);

  const handleValueChange = useCallback(
    (value: string) => {
      setValue(value);
      if (!composing) {
        findInPage.findInPage(value);
      }
      if (value.length === 0) {
        findInPage.clear();
      }
      inputRef.current?.focus();
    },
    [composing, findInPage]
  );

  const handleFocus = useCallback(() => {
    setActive(true);
  }, []);

  const handleBlur = useCallback(() => {
    setActive(false);
  }, []);

  useEffect(() => {
    const unsub = findInPage.isSearching$.subscribe(() => {
      inputRef.current?.focus();
      setTimeout(() => {
        inputRef.current?.focus();
      });
    });

    return () => {
      unsub.unsubscribe();
    };
  }, [findInPage.isSearching$]);

  const handleBackWard = useCallback(() => {
    findInPage.backward();
  }, [findInPage]);

  const handleForward = useCallback(() => {
    findInPage.forward();
  }, [findInPage]);

  const onChangeVisible = useCallback(
    (visible: boolean) => {
      if (!visible) {
        findInPage.clear();
      }
      findInPage.onChangeVisible(visible);
    },
    [findInPage]
  );

  const handleDone = useCallback(() => {
    onChangeVisible(false);
  }, [onChangeVisible]);

  const handleKeydown: KeyboardEventHandler = useCallback(
    e => {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        handleForward();
      }
      if (e.key === 'ArrowUp') {
        handleBackWard();
      }
    },
    [handleBackWard, handleForward]
  );

  const handleScroll = useCallback(
    (e: { currentTarget: { scrollLeft: SetStateAction<number> } }) => {
      setScrollLeft(e.currentTarget.scrollLeft);
    },
    []
  );

  const handleCompositionStart: CompositionEventHandler<HTMLInputElement> =
    useCallback(() => {
      setComposing(true);
    }, []);

  const handleCompositionEnd: CompositionEventHandler<HTMLInputElement> =
    useCallback(
      e => {
        setComposing(false);
        findInPage.findInPage(e.currentTarget.value);
      },
      [findInPage]
    );

  const handleReplaceOne = useCallback(() => {
    if (!activeDoc || activeDoc.readonly || !value) {
      return;
    }
    const matches = findTextMatchesInDoc(activeDoc, value, { caseSensitive });
    const ordinal = result?.activeMatchOrdinal
      ? Math.max(0, result.activeMatchOrdinal - 1)
      : 0;
    const occurrenceIndex =
      matches.length > 0 ? Math.min(ordinal, matches.length - 1) : 0;
    const { replaced, remaining } = replaceMatchInDoc(
      activeDoc,
      value,
      replaceValue,
      { caseSensitive, occurrenceIndex }
    );
    if (!replaced) {
      toast('No editable matches in this note');
      return;
    }
    if (remaining > 0) {
      requestAnimationFrame(() => findInPage.refresh());
    } else {
      findInPage.clear();
    }
  }, [activeDoc, caseSensitive, findInPage, replaceValue, result, value]);

  const handleReplaceAll = useCallback(() => {
    if (!activeDoc || activeDoc.readonly || !value) {
      return;
    }
    const { replacedCount } = replaceAllInDoc(activeDoc, value, replaceValue, {
      caseSensitive,
    });
    if (replacedCount === 0) {
      toast('No editable matches in this note');
      return;
    }
    toast(
      replacedCount === 1
        ? 'Replaced 1 match'
        : `Replaced ${replacedCount} matches`
    );
    const remaining = findTextMatchesInDoc(activeDoc, value, {
      caseSensitive,
    }).length;
    if (remaining > 0) {
      requestAnimationFrame(() => findInPage.refresh());
    } else {
      findInPage.clear();
    }
  }, [activeDoc, caseSensitive, findInPage, replaceValue, value]);

  return (
    <Popover.Root open={status !== 'exited'} onOpenChange={onChangeVisible}>
      <Popover.Anchor className={styles.anchor} data-find-in-page-anchor />
      <Popover.Portal>
        <Popover.Content
          style={assignInlineVars({
            [styles.animationTimeout]: `${animationTimeout}ms`,
          })}
          className={styles.contentContainer}
          data-state={status}
          sideOffset={5}
          side="left"
          onInteractOutside={e => {
            // do not close the popup when focus outside (like focus in the editor)
            e.preventDefault();
          }}
        >
          <div className={styles.row}>
            <div
              className={clsx(styles.inputContainer, {
                active: active || isSearching,
              })}
            >
              <SearchIcon className={styles.searchIcon} />
              <div className={styles.inputMain}>
                <RowInput
                  type="text"
                  autoFocus
                  value={value}
                  ref={inputRef}
                  style={{
                    visibility: isSearching ? 'hidden' : 'visible',
                  }}
                  onBlur={handleBlur}
                  onFocus={handleFocus}
                  className={styles.input}
                  onKeyDown={handleKeydown}
                  onChange={handleValueChange}
                  onScroll={handleScroll}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                />
                <CanvasText
                  className={styles.inputHack}
                  text={value}
                  scrollLeft={scrollLeft}
                />
              </div>
              <div className={styles.count}>
                {value.length > 0 && result && result.matches !== 0 ? (
                  <>
                    <span>{result?.activeMatchOrdinal || 0}</span>
                    <span>/</span>
                    <span>{result?.matches || 0}</span>
                  </>
                ) : value.length && !isSearching ? (
                  <span>No matches</span>
                ) : null}
              </div>
            </div>

            <div className={styles.arrowButtonContainer}>
              <IconButton
                size="24"
                className={styles.arrowButton}
                onClick={handleBackWard}
                icon={<ArrowUpSmallIcon />}
              />
              <IconButton
                size="24"
                className={styles.arrowButton}
                onClick={handleForward}
                icon={<ArrowDownSmallIcon />}
              />
            </div>

            <IconButton
              aria-label="Toggle find and replace"
              data-testid="find-in-page-toggle-replace"
              tooltip={showReplace ? 'Hide replace' : 'Find and replace'}
              onClick={() => setShowReplace(prev => !prev)}
              icon={<RiFindReplaceLine size={16} />}
            />

            <IconButton onClick={handleDone} icon={<CloseIcon />} />
          </div>

          {showReplace ? (
            <div className={styles.row} data-testid="find-in-page-replace-row">
              <input
                type="text"
                className={styles.replaceInput}
                placeholder={
                  activeDoc?.readonly ? 'Page is locked' : 'Replace with…'
                }
                value={replaceValue}
                disabled={!activeDoc || activeDoc.readonly}
                data-testid="find-in-page-replace-input"
                onChange={e => setReplaceValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && canReplace) {
                    e.preventDefault();
                    handleReplaceOne();
                  }
                }}
              />
              <button
                type="button"
                className={styles.actionPill}
                data-active={caseSensitive}
                aria-pressed={caseSensitive}
                title="Match case"
                data-testid="find-in-page-match-case"
                onClick={() => {
                  setCaseSensitive(prev => {
                    const next = !prev;
                    findInPage.setMatchCase(next);
                    return next;
                  });
                }}
              >
                Aa
              </button>
              <button
                type="button"
                className={styles.actionPill}
                disabled={!canReplace}
                data-testid="find-in-page-replace-one"
                onClick={handleReplaceOne}
              >
                Replace
              </button>
              <button
                type="button"
                className={styles.actionPill}
                disabled={!canReplace}
                data-testid="find-in-page-replace-all"
                onClick={handleReplaceAll}
              >
                All
              </button>
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
