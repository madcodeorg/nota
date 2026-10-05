const fontUrls = {
  'Inter-Regular.woff': new URL(
    './fonts/Inter-Regular.woff',
    import.meta.url
  ).toString(),
  'Inter-SemiBold.woff': new URL(
    './fonts/Inter-SemiBold.woff',
    import.meta.url
  ).toString(),
  'Inter-Italic.woff': new URL(
    './fonts/Inter-Italic.woff',
    import.meta.url
  ).toString(),
  'Inter-SemiBoldItalic.woff': new URL(
    './fonts/Inter-SemiBoldItalic.woff',
    import.meta.url
  ).toString(),
  'SarasaGothicCL-Regular.ttf': new URL(
    './fonts/SarasaGothicCL-Regular.ttf',
    import.meta.url
  ).toString(),
};

export const PDF_FONT_URLS = Object.values(fontUrls);

export const PDF_FONTS = {
  Inter: {
    normal: 'Inter-Regular.woff',
    bold: 'Inter-SemiBold.woff',
    italics: 'Inter-Italic.woff',
    bolditalics: 'Inter-SemiBoldItalic.woff',
  },
  SarasaGothicCL: {
    normal: 'SarasaGothicCL-Regular.ttf',
    bold: 'SarasaGothicCL-Regular.ttf',
    italics: 'SarasaGothicCL-Regular.ttf',
    bolditalics: 'SarasaGothicCL-Regular.ttf',
  },
};

let fontData: Promise<Record<string, string>> | null = null;

export function loadBundledPdfFonts() {
  fontData ??= Promise.all(
    Object.entries(fontUrls).map(async ([filename, url]) => {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Could not load bundled PDF font: ${filename}`);
      const blob = await response.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      return [filename, base64] as const;
    })
  )
    .then(Object.fromEntries)
    .catch(error => {
      fontData = null;
      throw error;
    });
  return fontData;
}
