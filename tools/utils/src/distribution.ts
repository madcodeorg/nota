import { PackageList, type PackageName } from './yarn';

export const PackageToDistribution = new Map<
  PackageName,
  BUILD_CONFIG_TYPE['distribution']
>([
  ['@nota/admin', 'admin'],
  ['@nota/web', 'web'],
  ['@nota/electron-renderer', 'desktop'],
  ['@nota/electron', 'desktop'],
  ['@nota/mobile', 'mobile'],
  ['@nota/ios', 'ios'],
  ['@nota/android', 'android'],
]);

export const AliasToPackage = new Map<string, PackageName>([
  ['admin', '@nota/admin'],
  ['web', '@nota/web'],
  ['electron', '@nota/electron'],
  ['desktop', '@nota/electron-renderer'],
  ['renderer', '@nota/electron-renderer'],
  ['mobile', '@nota/mobile'],
  ['ios', '@nota/ios'],
  ['android', '@nota/android'],
  ['gql', '@nota/graphql'],
  ...PackageList.map(
    pkg => [pkg.name.split('/').pop()!, pkg.name] as [string, PackageName]
  ),
]);
