// @vitest-environment happy-dom
import { Framework, MemoryMemento } from '@nota/infra';
import { beforeEach, describe, expect, test } from 'vitest';

import { GlobalState } from '../../../storage';
import { ViewScope } from '../../scopes/view';
import { WorkbenchNewTabHandler } from '../../services/workbench-new-tab-handler';
import { WorkbenchDefaultState } from '../../services/workbench-view-state';
import { SidebarTab } from '../sidebar-tab';
import { View } from '../view';
import { Workbench } from '../workbench';

describe('Workbench split views', () => {
  let workbench: Workbench;

  beforeEach(() => {
    const framework = new Framework();
    framework
      .entity(Workbench, [
        WorkbenchDefaultState,
        WorkbenchNewTabHandler,
        GlobalState,
      ])
      .entity(View)
      .scope(ViewScope)
      .entity(SidebarTab);
    framework.impl(WorkbenchDefaultState, {
      basename: '/',
      views: [{ id: 'a', path: { pathname: '/a' } }],
      activeViewIndex: 0,
    });
    framework.impl(WorkbenchNewTabHandler, { handle: () => {} });
    framework.impl(GlobalState, new MemoryMemento());
    workbench = framework.provider().get(Workbench);
  });

  const ids = () => workbench.views$.value.map(v => v.location$.value.pathname);
  const sizes = () => workbench.views$.value.map(v => v.size$.value);

  test('moveView moves a view instead of swapping', () => {
    workbench.createView('tail', '/b');
    workbench.createView('tail', '/c');
    workbench.moveView(0, 2);
    expect(ids()).toEqual(['/b', '/c', '/a']);
    expect(workbench.activeView$.value.location$.value.pathname).toBe('/a');

    workbench.moveView(2, 0);
    expect(ids()).toEqual(['/a', '/b', '/c']);
  });

  test('resize splits the pair by ratio and leaves other views alone', () => {
    workbench.createView('tail', '/b');
    workbench.createView('tail', '/c');
    workbench.resize(0, 0.25);
    expect(sizes()).toEqual([50, 150, 100]);
  });

  test('resize clamps to the minimum share instead of ignoring the move', () => {
    workbench.createView('tail', '/b');
    workbench.resize(0, 0.01, 0.2);
    expect(sizes()).toEqual([40, 160]);
    workbench.resize(0, 2, 0.2);
    expect(sizes()).toEqual([160, 40]);
  });

  test('resize ignores the last view and invalid ratios', () => {
    workbench.createView('tail', '/b');
    workbench.resize(1, 0.3);
    workbench.resize(0, Number.NaN);
    expect(sizes()).toEqual([100, 100]);
  });

  test('equalizeSizes resets every view', () => {
    workbench.createView('tail', '/b');
    workbench.resize(0, 0.3);
    workbench.equalizeSizes();
    expect(sizes()).toEqual([100, 100]);
  });
});
