import clsx from 'clsx';
import {
  type ForwardedRef,
  forwardRef,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { RiArrowRightSLine } from 'react-icons/ri';

import * as styles from './index.css';

export type CategoryDividerProps = PropsWithChildren<
  {
    label: string;
    icon?: ReactNode;
    className?: string;
    collapsed?: boolean;
    setCollapsed?: (collapsed: boolean) => void;
  } & {
    [key: `data-${string}`]: unknown;
  }
>;

export const CategoryDivider = forwardRef(
  (
    {
      label,
      icon,
      children,
      className,
      collapsed,
      setCollapsed,
      ...otherProps
    }: CategoryDividerProps,
    ref: ForwardedRef<HTMLDivElement>
  ) => {
    const collapsible = collapsed !== undefined;

    return (
      <div
        className={clsx(styles.root, className)}
        ref={ref}
        role="switch"
        onClick={() => setCollapsed?.(!collapsed)}
        data-collapsed={collapsed}
        data-collapsible={collapsible}
        {...otherProps}
      >
        <div className={styles.label}>
          {icon ? <span className={styles.icon}>{icon}</span> : null}
          <span>{label}</span>
          {collapsible ? (
            <RiArrowRightSLine
              size={14}
              data-testid="category-divider-collapse-button"
              className={styles.collapseIcon}
            />
          ) : null}
        </div>
        <div className={styles.actions} onClick={e => e.stopPropagation()}>
          {children}
        </div>
      </div>
    );
  }
);

CategoryDivider.displayName = 'CategoryDivider';
