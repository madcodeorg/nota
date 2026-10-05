import {
  ExportIcon,
  ExportToHtmlIcon,
  ExportToMarkdownIcon,
  ExportToPngIcon,
  PageIcon,
  PrinterIcon,
} from '@blocksuite/icons/rc';
import { MenuItem, MenuSeparator, MenuSub } from '@nota/component';
import { FeatureFlagService } from '@nota/core/modules/feature-flag';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import { track } from '@nota/track';
import type { ReactNode } from 'react';
import { useCallback } from 'react';

import { transitionStyle } from './index.css';

interface ExportMenuItemProps<T> {
  onSelect: () => void;
  className?: string;
  type: T;
  icon: ReactNode;
  label: string;
}

interface ExportProps {
  exportHandler: (
    type:
      | 'pdf'
      | 'html'
      | 'png'
      | 'markdown'
      | 'snapshot'
      | 'pdf-export'
      | 'csv'
  ) => void;
  pageMode?: 'page' | 'edgeless';
  className?: string;
  hasDatabases?: boolean;
}

export function ExportMenuItem<T>({
  onSelect,
  className,
  type,
  icon,
  label,
}: ExportMenuItemProps<T>) {
  return (
    <MenuItem
      className={className}
      data-testid={`export-to-${type}`}
      onSelect={onSelect}
      block
      prefixIcon={icon}
    >
      {label}
    </MenuItem>
  );
}

export const PrintMenuItems = ({
  exportHandler,
  className = transitionStyle,
}: ExportProps) => {
  const t = useI18n();
  return (
    <ExportMenuItem
      onSelect={() => exportHandler('pdf')}
      className={className}
      type="pdf"
      icon={<PrinterIcon />}
      label={t['com.affine.export.print']()}
    />
  );
};

export const ExportMenuItems = ({
  exportHandler,
  className = transitionStyle,
  pageMode = 'page',
  hasDatabases = false,
}: ExportProps) => {
  const t = useI18n();
  const featureFlags = useService(FeatureFlagService).flags;
  const enable_pdfmake_export = useLiveData(
    featureFlags.enable_pdfmake_export.$
  );

  return (
    <>
      <ExportMenuItem
        onSelect={() => exportHandler('html')}
        className={className}
        type="html"
        icon={<ExportToHtmlIcon />}
        label={t['Export to HTML']()}
      />
      {pageMode !== 'edgeless' && (
        <ExportMenuItem
          onSelect={() => exportHandler('png')}
          className={className}
          type="png"
          icon={<ExportToPngIcon />}
          label={t['Export to PNG']()}
        />
      )}
      <ExportMenuItem
        onSelect={() => exportHandler('markdown')}
        className={className}
        type="markdown"
        icon={<ExportToMarkdownIcon />}
        label={t['Export to Markdown']()}
      />
      {hasDatabases && (
        <ExportMenuItem
          onSelect={() => exportHandler('csv')}
          className={className}
          type="csv"
          icon={<PageIcon />}
          label="Export databases to CSV"
        />
      )}
      {pageMode !== 'edgeless' && enable_pdfmake_export && (
        <ExportMenuItem
          onSelect={() => exportHandler('pdf-export')}
          className={className}
          type="pdf-export"
          icon={<PrinterIcon />}
          label={t['Export to PDF']()}
        />
      )}
      <ExportMenuItem
        onSelect={() => exportHandler('snapshot')}
        className={className}
        type="snapshot"
        icon={<PageIcon />}
        label={t['Export to Snapshot']()}
      />
    </>
  );
};

export const Export = ({
  exportHandler,
  className,
  pageMode,
  hasDatabases,
}: ExportProps) => {
  const t = useI18n();
  const items = (
    <>
      <ExportMenuItems
        exportHandler={exportHandler}
        className={className}
        pageMode={pageMode}
        hasDatabases={hasDatabases}
      />
      {pageMode !== 'edgeless' && (
        <>
          <MenuSeparator />
          <PrintMenuItems exportHandler={exportHandler} className={className} />
        </>
      )}
    </>
  );
  const handleExportMenuOpenChange = useCallback((open: boolean) => {
    if (open) {
      track.$.header.docOptions.export();
    }
  }, []);

  return (
    <MenuSub
      items={items}
      triggerOptions={{
        className: transitionStyle,
        prefixIcon: <ExportIcon />,
        'data-testid': 'export-menu',
      }}
      subOptions={{
        onOpenChange: handleExportMenuOpenChange,
      }}
    >
      {t.Export()}
    </MenuSub>
  );
};
