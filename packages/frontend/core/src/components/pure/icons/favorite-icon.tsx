import { IconStar, IconStarFilled } from '@tabler/icons-react';
import { cssVar } from '@toeverything/theme';
import type { SVGProps } from 'react';

export const IsFavoriteIcon = ({
  favorite,
  style,
  ...props
}: { favorite?: boolean } & SVGProps<SVGSVGElement>) => {
  const StarIcon = favorite ? IconStarFilled : IconStar;
  return (
    <StarIcon
      size={20}
      stroke={favorite ? 1.7 : 1.9}
      style={{ color: favorite ? cssVar('primaryColor') : undefined, ...style }}
      {...props}
    />
  );
};
