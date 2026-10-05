import { ExplorerNavigation } from '@nota/core/components/explorer/header/navigation';
import { Header } from '@nota/core/components/pure/header';

export const AllTagHeader = () => {
  return <Header left={<ExplorerNavigation active={'tags'} />} />;
};
