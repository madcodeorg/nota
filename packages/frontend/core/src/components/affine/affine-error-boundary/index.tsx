import type { ErrorInfo, FC, PropsWithChildren } from 'react';
import { useCallback } from 'react';
import {
  ErrorBoundary,
  type FallbackProps as ErrorBoundaryFallbackProps,
} from 'react-error-boundary';

import { AffineErrorFallback } from './affine-error-fallback';

export { type FallbackProps } from './error-basic/fallback-creator';

export interface AffineErrorBoundaryProps extends PropsWithChildren {
  height?: number | string;
  className?: string;
}

/**
 * TODO(@eyhn): Unify with SWRErrorBoundary
 */
export const AffineErrorBoundary: FC<AffineErrorBoundaryProps> = props => {
  const fallbackRender = useCallback(
    ({ error, resetErrorBoundary }: ErrorBoundaryFallbackProps) => {
      return (
        <AffineErrorFallback
          error={error}
          resetError={resetErrorBoundary}
          height={props.height}
          className={props.className}
        />
      );
    },
    [props.height, props.className]
  );

  const onError = useCallback((error: unknown, info: ErrorInfo) => {
    console.error('Uncaught error:', error, info.componentStack);
  }, []);

  return (
    <ErrorBoundary fallbackRender={fallbackRender} onError={onError}>
      {props.children}
    </ErrorBoundary>
  );
};
