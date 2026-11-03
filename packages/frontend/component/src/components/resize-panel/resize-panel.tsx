import { assignInlineVars } from '@vanilla-extract/dynamic';
import clsx from 'clsx';
import { forwardRef, useCallback, useLayoutEffect, useRef } from 'react';
import { useTransitionState } from 'react-transition-state';

import { useDropTarget } from '../../ui/dnd';
import { Tooltip, type TooltipProps } from '../../ui/tooltip';
import * as styles from './resize-panel.css';

export interface ResizeHandleProps extends React.HtmlHTMLAttributes<HTMLDivElement> {
  resizing: boolean;
  open: boolean;
  minWidth: number;
  maxWidth: number;
  resizeHandlePos: 'left' | 'right';
  resizeHandleOffset?: number;
  resizeHandleVerticalPadding?: number;
  onOpen: (open: boolean) => void;
  onResizing: (resizing: boolean) => void;
  onWidthChange: (width: number) => void;
  onWidthChanged?: (width: number) => void;
  collapseThreshold?: number;
  tooltip?: TooltipProps['content'];
  tooltipShortcut?: TooltipProps['shortcut'];
  tooltipOptions?: Partial<Omit<TooltipProps, 'content' | 'shortcut'>>;
  tooltipShortcutClassName?: string;
  dropTargetOptions?: Parameters<typeof useDropTarget>[0];
}

export interface ResizePanelProps extends React.HtmlHTMLAttributes<HTMLDivElement> {
  resizing: boolean;
  open: boolean;
  floating?: boolean;
  minWidth: number;
  maxWidth: number;
  resizeHandlePos: 'left' | 'right';
  resizeHandleOffset?: number;
  resizeHandleVerticalPadding?: number;
  resizeHandleTooltip?: TooltipProps['content'];
  resizeHandleTooltipShortcut?: TooltipProps['shortcut'];
  resizeHandleTooltipShortcutClassName?: string;
  resizeHandleTooltipOptions?: Partial<
    Omit<TooltipProps, 'content' | 'shortcut'>
  >;
  resizeHandleDropTargetOptions?: Parameters<typeof useDropTarget>[0];
  enableAnimation?: boolean;
  /** dragging this many px below minWidth closes the panel on release */
  collapseThreshold?: number;
  width: number;
  unmountOnExit?: boolean;
  onOpen: (open: boolean) => void;
  onResizing: (resizing: boolean) => void;
  onWidthChange: (width: number) => void;
  onWidthChanged?: (width: number) => void;
}

const ResizeHandle = ({
  className,
  resizing,
  minWidth,
  maxWidth,
  resizeHandlePos,
  resizeHandleOffset,
  resizeHandleVerticalPadding,
  dropTargetOptions,
  open,
  onOpen,
  onResizing,
  onWidthChange,
  onWidthChanged,
  collapseThreshold,
  tooltip,
  tooltipShortcut,
  tooltipOptions,
  tooltipShortcutClassName,
  ...rest
}: ResizeHandleProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const onResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const panelContainer = ref.current?.parentElement;
      if (!panelContainer) return;

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const { left: anchorLeft, right: anchorRight } =
        panelContainer.getBoundingClientRect();
      const startX = event.clientX;

      let resized = false;
      let willCollapse = false;
      let lastWidth: number | undefined;
      let latestX = startX;
      let frame = 0;

      const apply = () => {
        frame = 0;
        const rawWidth =
          resizeHandlePos === 'right'
            ? latestX - anchorLeft
            : anchorRight - latestX;
        willCollapse =
          collapseThreshold !== undefined &&
          rawWidth < minWidth - collapseThreshold;
        panelContainer.dataset.willCollapse = String(willCollapse);
        const newWidth = Math.min(maxWidth, Math.max(rawWidth, minWidth));
        if (newWidth !== lastWidth) {
          lastWidth = newWidth;
          onWidthChange(newWidth);
        }
      };

      const listeners = new AbortController();
      const onPointerMove = (e: PointerEvent) => {
        latestX = e.clientX;
        // a few pixels of jitter on click should still count as a click
        if (!resized && Math.abs(latestX - startX) < 3) return;
        if (!resized) {
          resized = true;
          onResizing(true);
        }
        if (!frame) frame = requestAnimationFrame(apply);
      };
      const onEnd = () => {
        listeners.abort();
        if (frame) {
          cancelAnimationFrame(frame);
          apply();
        }
        delete panelContainer.dataset.willCollapse;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        onResizing(false);
        // a plain click, or dragging well past the minimum, closes the panel
        if (!resized || willCollapse) {
          onOpen(false);
        }
        if (lastWidth) onWidthChanged?.(lastWidth);
      };

      const { signal } = listeners;
      window.addEventListener('pointermove', onPointerMove, { signal });
      window.addEventListener('pointerup', onEnd, { signal });
      window.addEventListener('pointercancel', onEnd, { signal });
      window.addEventListener('blur', onEnd, { signal });
    },
    [
      collapseThreshold,
      maxWidth,
      resizeHandlePos,
      minWidth,
      onWidthChange,
      onResizing,
      onWidthChanged,
      onOpen,
    ]
  );

  const { dropTargetRef } = useDropTarget(dropTargetOptions, [
    dropTargetOptions,
  ]);

  return (
    <Tooltip
      content={tooltip}
      shortcut={tooltipShortcut}
      shortcutClassName={tooltipShortcutClassName}
      {...tooltipOptions}
    >
      <div
        {...rest}
        data-testid="resize-handle"
        ref={node => {
          ref.current = node;
          dropTargetRef.current = node;
        }}
        style={assignInlineVars({
          [styles.resizeHandleOffsetVar]: `${resizeHandleOffset ?? 0}px`,
          [styles.resizeHandleVerticalPadding]: `${
            resizeHandleVerticalPadding ?? 0
          }px`,
        })}
        className={clsx(styles.resizeHandleContainer, className)}
        data-handle-position={resizeHandlePos}
        data-resizing={resizing}
        data-open={open}
        onPointerDown={onResizeStart}
      >
        <div className={styles.resizerInner} />
      </div>
    </Tooltip>
  );
};

const animationTimeout = 300;

export const ResizePanel = forwardRef<HTMLDivElement, ResizePanelProps>(
  function ResizePanel(
    {
      children,
      className,
      resizing,
      minWidth,
      maxWidth,
      width,
      floating,
      enableAnimation = true,
      collapseThreshold,
      open,
      unmountOnExit,
      onOpen,
      onResizing,
      onWidthChange,
      onWidthChanged,
      resizeHandlePos,
      resizeHandleOffset,
      resizeHandleVerticalPadding,
      resizeHandleTooltip,
      resizeHandleTooltipShortcut,
      resizeHandleTooltipShortcutClassName,
      resizeHandleTooltipOptions,
      resizeHandleDropTargetOptions,
      ...rest
    },
    ref
  ) {
    const safeWidth = Math.min(maxWidth, Math.max(minWidth, width));
    const [{ status }, toggle] = useTransitionState({
      timeout: animationTimeout,
    });
    useLayoutEffect(() => {
      toggle(open);
    }, [open, toggle]);
    return (
      <div
        {...rest}
        ref={ref}
        style={assignInlineVars({
          [styles.panelWidthVar]: `${safeWidth}px`,
          [styles.animationTimeout]: `${animationTimeout}ms`,
        })}
        className={clsx(className, styles.root)}
        data-open={open}
        data-transition-state={status}
        data-is-floating={floating}
        data-handle-position={resizeHandlePos}
        data-enable-animation={enableAnimation && !resizing}
      >
        <div className={styles.content}>
          {!(status === 'exited' && unmountOnExit !== false) && children}
        </div>
        <ResizeHandle
          resizeHandlePos={resizeHandlePos}
          resizeHandleOffset={resizeHandleOffset}
          resizeHandleVerticalPadding={resizeHandleVerticalPadding}
          tooltip={resizeHandleTooltip}
          tooltipOptions={resizeHandleTooltipOptions}
          tooltipShortcut={resizeHandleTooltipShortcut}
          tooltipShortcutClassName={resizeHandleTooltipShortcutClassName}
          maxWidth={maxWidth}
          minWidth={minWidth}
          onOpen={onOpen}
          onResizing={onResizing}
          onWidthChange={onWidthChange}
          onWidthChanged={onWidthChanged}
          collapseThreshold={collapseThreshold}
          open={open}
          resizing={resizing}
          dropTargetOptions={resizeHandleDropTargetOptions}
        />
      </div>
    );
  }
);
