import { DebugLogger } from '@nota/debug';
import { Entity, LiveData } from '@nota/infra';
import {
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  of,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs';

import type { DesktopApiService } from '../../desktop-api';

const logger = new DebugLogger('nota:find-in-page');

export class FindInPage extends Entity {
  readonly searchText$ = new LiveData<string | null>(null);
  readonly isSearching$ = new LiveData(false);
  readonly matchCase$ = new LiveData(false);
  private readonly direction$ = new LiveData<'forward' | 'backward'>('forward');
  private readonly searchRevision$ = new LiveData(0);
  private readonly cleared$ = new LiveData(false);
  readonly visible$ = new LiveData(false);

  readonly result$ = LiveData.from(
    this.visible$.pipe(
      distinctUntilChanged(),
      switchMap(visible => {
        if (!visible) {
          return of(null);
        }
        let searchId = 0;
        const debouncedSearchText$ = this.searchText$.pipe(
          tap(() => {
            this.isSearching$.next(false);
          }),
          debounceTime(200)
        );
        return combineLatest([
          debouncedSearchText$,
          this.matchCase$,
          this.searchRevision$,
          this.cleared$,
        ]).pipe(
          switchMap(([searchText, matchCase, , cleared]) => {
            if (!searchText || cleared) {
              this.isSearching$.next(false);
              return of(null);
            } else {
              let findNext = true;
              return this.direction$.pipe(
                switchMap(direction => {
                  if (this.electronApi?.handler?.findInPage) {
                    this.isSearching$.next(true);
                    const currentId = ++searchId;
                    return this.electronApi.handler.findInPage
                      .find(searchText, {
                        forward: direction === 'forward',
                        findNext,
                        matchCase,
                      })
                      .finally(() => {
                        if (currentId === searchId) {
                          this.isSearching$.next(false);
                          findNext = false;
                        }
                      });
                  } else {
                    this.isSearching$.next(false);
                    return of(null);
                  }
                })
              );
            }
          })
        );
      }),
      shareReplay({
        bufferSize: 1,
        refCount: true,
      })
    ),
    null
  );

  constructor(private readonly electronApi: DesktopApiService) {
    super();
    // TODO(@Peng): hide on navigation
  }

  findInPage(searchText?: string) {
    this.onChangeVisible(true);
    if (searchText !== undefined) {
      this.cleared$.next(false);
      this.searchText$.next(searchText);
    }
  }

  setMatchCase(matchCase: boolean) {
    if (this.matchCase$.value === matchCase) {
      return;
    }
    this.matchCase$.next(matchCase);
    if (this.searchText$.value) {
      this.cleared$.next(false);
      this.searchRevision$.next(this.searchRevision$.value + 1);
    }
  }

  refresh() {
    if (!this.searchText$.value) {
      this.clear();
      return;
    }
    this.cleared$.next(false);
    this.searchRevision$.next(this.searchRevision$.value + 1);
  }

  onChangeVisible(visible: boolean) {
    this.visible$.next(visible);
    if (!visible) {
      this.clear();
    }
  }

  toggleVisible(text?: string) {
    const nextVisible = !this.visible$.value;
    this.visible$.next(nextVisible);
    if (!nextVisible) {
      this.clear();
    } else if (text) {
      this.cleared$.next(false);
      this.searchText$.next(text);
    }
  }

  backward() {
    if (!this.searchText$.value) {
      return;
    }
    this.direction$.next('backward');
  }

  forward() {
    if (!this.searchText$.value) {
      return;
    }
    this.direction$.next('forward');
  }

  clear() {
    logger.debug('clear');
    this.cleared$.next(true);
    this.isSearching$.next(false);
    this.electronApi.handler.findInPage.clear().catch(logger.error);
  }
}
