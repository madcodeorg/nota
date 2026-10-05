import { Page } from '../../../components/page';
import { AllDocsHeader, CollectionList } from '../../../views';

export const Component = () => {
  return (
    <Page header={<AllDocsHeader />} tab>
      <CollectionList />
    </Page>
  );
};
