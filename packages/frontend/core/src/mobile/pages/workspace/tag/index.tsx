import { Page } from '../../../components/page';
import { AllDocsHeader, TagList } from '../../../views';

export const Component = () => {
  return (
    <Page header={<AllDocsHeader />} tab>
      <TagList />
    </Page>
  );
};
