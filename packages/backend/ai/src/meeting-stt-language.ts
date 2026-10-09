import { getLocalModelRegistry } from './model-registry';

export function meetingSttLanguages(providerId: string) {
  const models = getLocalModelRegistry();
  if (providerId === 'nemotron-sherpa')
    return (
      models.find(model => model.sherpaKind === 'nemotron-streaming')
        ?.languages ?? []
    );
  if (providerId.startsWith('whisper-') && providerId.endsWith('-cpp')) {
    return (
      models.find(model => model.id === providerId.replace(/-cpp$/, '-q5-cpp'))
        ?.languages ?? []
    );
  }
  return [];
}
export function validateMeetingSttLanguage(value: unknown = 'auto') {
  if (value === 'auto') return value;
  if (typeof value !== 'string' || value.length > 32)
    throw new Error('Unsupported meeting transcription language.');
  try {
    if (new Intl.Locale(value).toString() !== value)
      throw new Error('Non-canonical locale.');
  } catch {
    throw new Error('Unsupported meeting transcription language.');
  }
  // Apple locales are validated against the device's advertised catalog at the API boundary.
  const known = getLocalModelRegistry().some(
    model => model.type === 'stt' && model.languages.includes(value)
  );
  if (!known && !value.includes('-'))
    throw new Error('Unsupported meeting transcription language.');
  return value;
}
export function validateMeetingSttLanguageProvider(
  language: string,
  providerId: string
) {
  validateMeetingSttLanguage(language);
  if (
    language !== 'auto' &&
    providerId !== 'apple-speechanalyzer' &&
    !meetingSttLanguages(providerId).includes(language)
  ) {
    throw new Error(
      'Unsupported meeting transcription language for this model. Choose Auto or a supported language.'
    );
  }
}
