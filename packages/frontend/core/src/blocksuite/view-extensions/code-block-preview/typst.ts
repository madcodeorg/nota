import { $typst, type BeforeBuildFn, loadFonts } from '@myriaddreamin/typst.ts';

const BUNDLED_FONT_URLS = [
  new URL(
    '../../../../../component/src/fonts/source-serif-4/SourceSerif4-Regular.ttf',
    import.meta.url
  ).toString(),
  new URL(
    '../../../../../component/src/fonts/source-serif-4/SourceSerif4-Bold.ttf',
    import.meta.url
  ).toString(),
  new URL(
    '../../../../../component/src/fonts/source-serif-4/SourceSerif4-Italic.ttf',
    import.meta.url
  ).toString(),
  new URL(
    '../../../../../component/src/fonts/source-serif-4/SourceSerif4-BoldItalic.ttf',
    import.meta.url
  ).toString(),
  new URL(
    '../../../../../component/src/fonts/ibm-plex-mono/IBMPlexMono-Regular.ttf',
    import.meta.url
  ).toString(),
] as const;

const getBeforeBuildHooks = (): BeforeBuildFn[] => [
  loadFonts([...BUNDLED_FONT_URLS]),
];

const compilerWasmUrl = new URL(
  '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm',
  import.meta.url
).toString();

const rendererWasmUrl = new URL(
  '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm',
  import.meta.url
).toString();

let typstInitPromise: Promise<void> | null = null;

export async function ensureTypstReady() {
  if (typstInitPromise) {
    return typstInitPromise;
  }

  typstInitPromise = Promise.resolve()
    .then(() => {
      $typst.setCompilerInitOptions({
        beforeBuild: getBeforeBuildHooks(),
        getModule: () => compilerWasmUrl,
      });

      $typst.setRendererInitOptions({
        beforeBuild: getBeforeBuildHooks(),
        getModule: () => rendererWasmUrl,
      });
    })
    .catch(error => {
      typstInitPromise = null;
      throw error;
    });

  return typstInitPromise;
}

export async function getTypst() {
  await ensureTypstReady();
  return $typst;
}

export const TYPST_FONT_URLS = BUNDLED_FONT_URLS;
