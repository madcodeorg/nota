import { memo } from 'react';

export default memo(function Logo() {
  return (
    <svg
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="120" height="120" fill="white" />
      <text
        x="50%"
        y="55%"
        dominantBaseline="middle"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="90"
        fontStyle="italic"
        fill="black"
      >
        n
      </text>
    </svg>
  );
});
