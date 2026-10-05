# iOS

Nota iOS app.

## Build

- `yarn install`
- `BUILD_TYPE=canary PUBLIC_PATH="/" yarn nota @nota/ios build`
- `yarn nota @nota/ios cap sync`
- `yarn nota @nota/ios cap open ios`

## Live Reload

> Capacitor doc: https://capacitorjs.com/docs/guides/live-reload#using-with-framework-clis

- `yarn install`
- `yarn dev`
  - select `ios` for the "Distribution" option
- `yarn nota @nota/ios sync:dev`
- `yarn nota @nota/ios cap open ios`
