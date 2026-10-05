import { useAppSettingHelper } from '@nota/core/components/hooks/nota/use-app-setting-helper';
import { RootAppSidebar } from '@nota/core/components/root-app-sidebar';
import { AppSidebarService } from '@nota/core/modules/app-sidebar';
import {
  AppSidebarFallback,
  OpenInAppCard,
  SidebarSwitch,
} from '@nota/core/modules/app-sidebar/views';
import { AppTabsHeader } from '@nota/core/modules/app-tabs-header';
import { NavigationButtons } from '@nota/core/modules/navigation';
import { CMDKQuickSearchService } from '@nota/core/modules/quicksearch/services/cmdk';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useLiveData, useService, useServiceOptional } from '@nota/infra';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import clsx from 'clsx';
import {
  forwardRef,
  type HTMLAttributes,
  type PropsWithChildren,
  type ReactElement,
  useCallback,
} from 'react';

import * as styles from './styles.css';

export const AppContainer = ({
  children,
  className,
  fallback = false,
  ...rest
}: PropsWithChildren<{
  className?: string;
  fallback?: boolean;
}>) => {
  const { appSettings } = useAppSettingHelper();

  const noisyBackground =
    BUILD_CONFIG.isElectron && appSettings.enableNoisyBackground;
  const blurBackground =
    BUILD_CONFIG.isElectron &&
    environment.isMacOs &&
    appSettings.enableBlurBackground;
  return (
    <div
      {...rest}
      className={clsx(styles.appStyle, className, {
        'noisy-background': noisyBackground,
        'blur-background': blurBackground,
      })}
      data-noise-background={noisyBackground}
      data-translucent={blurBackground}
    >
      <LayoutComponent fallback={fallback}>{children}</LayoutComponent>
    </div>
  );
};

const DesktopLayout = ({
  children,
  fallback = false,
}: PropsWithChildren<{ fallback?: boolean }>) => {
  const workspaceService = useServiceOptional(WorkspaceService);
  const isInWorkspace = !!workspaceService;
  return (
    <div className={styles.desktopAppViewContainer}>
      <div className={styles.desktopTabsHeader}>
        <AppTabsHeader
          left={
            <>
              {isInWorkspace && (
                <div className={styles.headerLeftCluster}>
                  <SidebarSwitch show />
                  <HeaderQuickSearchPill />
                </div>
              )}
              {isInWorkspace && <NavigationButtons />}
            </>
          }
        />
      </div>
      <div className={styles.desktopAppViewMain}>
        {fallback ? (
          <AppSidebarFallback />
        ) : (
          isInWorkspace && <RootAppSidebar />
        )}
        <MainContainer>{children}</MainContainer>
      </div>
    </div>
  );
};

const HeaderQuickSearchPill = () => {
  const quickSearchService = useService(CMDKQuickSearchService);
  const appSidebarService = useService(AppSidebarService).sidebar;
  const sidebarOpen = useLiveData(appSidebarService.open$);

  const openQuickSearch = useCallback(() => {
    quickSearchService.toggle();
  }, [quickSearchService]);

  if (!sidebarOpen) {
    return null;
  }

  return (
    <button
      aria-label="Search"
      className={styles.headerSearchPill}
      data-event-props="$.navigationPanel.$.quickSearch"
      data-testid="slider-bar-quick-search-button"
      title="Search"
      type="button"
      onClick={openQuickSearch}
    >
      <MagnifyingGlassIcon
        aria-hidden
        className={styles.headerSearchPillIcon}
        size={15}
        weight="bold"
      />
      <span className={styles.headerSearchPillLabel}>Search</span>
    </button>
  );
};

const BrowserLayout = ({
  children,
  fallback = false,
}: PropsWithChildren<{ fallback?: boolean }>) => {
  const workspaceService = useServiceOptional(WorkspaceService);
  const isInWorkspace = !!workspaceService;

  return (
    <div className={styles.browserAppViewContainer}>
      <OpenInAppCard />
      {fallback ? <AppSidebarFallback /> : isInWorkspace && <RootAppSidebar />}
      <MainContainer>{children}</MainContainer>
    </div>
  );
};

const LayoutComponent = BUILD_CONFIG.isElectron ? DesktopLayout : BrowserLayout;

const MainContainer = forwardRef<
  HTMLDivElement,
  PropsWithChildren<HTMLAttributes<HTMLDivElement>>
>(function MainContainer({ className, children, ...props }, ref): ReactElement {
  const workspaceService = useServiceOptional(WorkspaceService);
  const isInWorkspace = !!workspaceService;
  const { appSettings } = useAppSettingHelper();
  const appSidebarService = useService(AppSidebarService).sidebar;
  const open = useLiveData(appSidebarService.open$);

  return (
    <div
      {...props}
      className={clsx(styles.mainContainerStyle, className)}
      data-is-desktop={BUILD_CONFIG.isElectron}
      data-transparent={false}
      data-client-border={appSettings.clientBorder}
      data-side-bar-open={open && isInWorkspace}
      data-testid="main-container"
      ref={ref}
    >
      {children}
    </div>
  );
});

MainContainer.displayName = 'MainContainer';
