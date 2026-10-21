import { TextIcon } from '@blocksuite/icons/rc';
import { PropertyName, PropertyRoot, PropertyValue } from '@nota/component';
import { DocService } from '@nota/core/modules/doc';
import { getDocWordStats } from '@nota/core/utils/word-count';
import { useService } from '@nota/infra';
import { debounce } from 'lodash-es';
import { useEffect, useState } from 'react';

export const WordCountRow = () => {
  const doc = useService(DocService).doc;
  const [stats, setStats] = useState(() => getDocWordStats(doc.blockSuiteDoc));

  useEffect(() => {
    const update = debounce(() => {
      setStats(getDocWordStats(doc.blockSuiteDoc));
    }, 400);
    update();
    doc.yDoc.on('update', update);
    return () => {
      doc.yDoc.off('update', update);
      update.cancel();
    };
  }, [doc]);

  return (
    <PropertyRoot data-testid="doc-info-word-count">
      <PropertyName name="Words" icon={<TextIcon />} />
      <PropertyValue readonly hoverable={false}>
        {stats.words.toLocaleString()} words
        {stats.minutes > 0 ? ` · ${stats.minutes} min read` : ''}
      </PropertyValue>
    </PropertyRoot>
  );
};
