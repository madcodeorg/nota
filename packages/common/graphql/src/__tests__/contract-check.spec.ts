import { describe, expect, it } from 'vitest';

import { checkClientContract } from '../contract-check';

const operation = 'query CurrentUser { user { ...Profile } }';
const fragment = 'fragment Profile on User { name }';
const sources = [operation, fragment];
const generated = {
  currentUserQuery: {
    id: 'currentUserQuery',
    op: 'CurrentUser',
    query: operation + '\n' + fragment,
  },
  profileFragment: fragment,
};

describe('retained GraphQL client consistency', () => {
  it('checks syntax and generated text without a server schema', () => {
    expect(checkClientContract(sources, generated)).toBe(2);
  });

  it('allows fragments supplied separately while requiring complete executable operations', () => {
    const child = 'fragment DisplayName on User { name }';
    const parent = 'fragment Profile on User { ...DisplayName }';
    expect(
      checkClientContract([parent, child], {
        profileFragment: parent,
        displayNameFragment: child,
      })
    ).toBe(2);
  });

  it('rejects syntax errors and duplicate source definitions', () => {
    expect(() => checkClientContract(['query {'], {})).toThrow();
    expect(() =>
      checkClientContract([...sources, fragment], generated)
    ).toThrow('Duplicate');
  });

  it('rejects changed source fields when generated text has not been updated', () => {
    expect(() =>
      checkClientContract(
        [operation, fragment.replace('name', 'email')],
        generated
      )
    ).toThrow('Stale generated query text');
  });

  it('rejects missing fragment imports in generated operations', () => {
    expect(() =>
      checkClientContract(sources, {
        ...generated,
        currentUserQuery: { ...generated.currentUserQuery, query: operation },
      })
    ).toThrow('Missing generated fragment');
  });

  it('rejects missing, obsolete and incorrectly named generated exports', () => {
    expect(() =>
      checkClientContract(sources, { profileFragment: fragment })
    ).toThrow('Missing generated');
    expect(() =>
      checkClientContract(sources, { ...generated, oldFragment: fragment })
    ).toThrow('Obsolete');
    expect(() =>
      checkClientContract(sources, {
        ...generated,
        currentUserQuery: {
          ...generated.currentUserQuery,
          op: 'DifferentUser',
        },
      })
    ).toThrow('Stale generated operation metadata');
  });

  it('rejects cyclic fragment references', () => {
    const cyclic = 'fragment Profile on User { ...Profile }';
    expect(() =>
      checkClientContract([cyclic], { profileFragment: cyclic })
    ).toThrow('Cyclic');
  });
});
