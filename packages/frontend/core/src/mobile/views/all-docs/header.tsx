import { MoreHorizontalIcon } from '@blocksuite/icons/rc';
import { IconButton, MobileMenu, SafeArea } from '@nota/component';

import { header, headerContent, headerSpace } from './style.css';
import { AllDocsTabs } from './tabs';

export interface AllDocsHeaderProps {
  operations?: React.ReactNode;
}

export const AllDocsHeader = ({ operations }: AllDocsHeaderProps) => {
  return (
    <>
      <SafeArea top className={header}>
        <header className={headerContent}>
          <AllDocsTabs />
          <div>
            {operations ? (
              <MobileMenu items={operations}>
                <IconButton icon={<MoreHorizontalIcon />} />
              </MobileMenu>
            ) : null}
          </div>
        </header>
      </SafeArea>
      <SafeArea top>
        <div className={headerSpace} />
      </SafeArea>
    </>
  );
};
