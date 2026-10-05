import type { SVGProps } from 'react';
import { forwardRef } from 'react';

export const NotaLogoIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  function NotaLogoIcon(props, ref) {
    return (
      <svg
        ref={ref}
        viewBox="0 0 24 24"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <text
          x="50%"
          y="55%"
          dominantBaseline="middle"
          textAnchor="middle"
          fontFamily="Georgia, 'Times New Roman', serif"
          fontSize="20"
          fontStyle="italic"
          fill="currentColor"
        >
          n
        </text>
      </svg>
    );
  }
);
