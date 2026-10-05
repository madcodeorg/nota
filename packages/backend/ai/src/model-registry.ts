export interface LocalModelManifest {
  id: string;
  type: 'embedding' | 'stt' | 'text';
  runtime:
    | 'apple-speech'
    | 'cactus-needle'
    | 'whisper.cpp'
    | 'onnxruntime-genai'
    | 'onnxruntime'
    | 'sherpa-onnx';
  tier?: 'small' | 'medium' | 'large';
  downloadUrl: string;
  files?: string[];
  fileSha256?: Record<string, string>;
  repoId?: string;
  revision?: string;
  sha256: string;
  sizeMb: number;
  streaming: boolean;
  languages: string[];
  languageDetection?: 'automatic' | 'fixed' | 'selectable';
  languageDetectorModelId?: string;
  languageDetectorRequired?: boolean;
  sherpaKind?:
    | 'cohere-offline'
    | 'distil-whisper-offline'
    | 'moonshine-offline'
    | 'nemotron-streaming'
    | 'parakeet-offline'
    | 'whisper-offline';
  license: string;
  minRamGb: number;
  contextWindowTokens?: number;
  usageGuidance?: string;
  notes?: string;
  releaseState?: 'blocked' | 'planned' | 'ready';
}

// Supported language codes from the pinned whisper.cpp language table.
const WHISPER_LANGUAGES = [
  'en',
  'zh',
  'de',
  'es',
  'ru',
  'ko',
  'fr',
  'ja',
  'pt',
  'tr',
  'pl',
  'ca',
  'nl',
  'ar',
  'sv',
  'it',
  'id',
  'hi',
  'fi',
  'vi',
  'he',
  'uk',
  'el',
  'ms',
  'cs',
  'ro',
  'da',
  'hu',
  'ta',
  'no',
  'th',
  'ur',
  'hr',
  'bg',
  'lt',
  'la',
  'mi',
  'ml',
  'cy',
  'sk',
  'te',
  'fa',
  'lv',
  'bn',
  'sr',
  'az',
  'sl',
  'kn',
  'et',
  'mk',
  'br',
  'eu',
  'is',
  'hy',
  'ne',
  'mn',
  'bs',
  'kk',
  'sq',
  'sw',
  'gl',
  'mr',
  'pa',
  'si',
  'km',
  'sn',
  'yo',
  'so',
  'af',
  'oc',
  'ka',
  'be',
  'tg',
  'sd',
  'gu',
  'am',
  'yi',
  'lo',
  'uz',
  'fo',
  'ht',
  'ps',
  'tk',
  'nn',
  'mt',
  'sa',
  'lb',
  'my',
  'bo',
  'tl',
  'mg',
  'as',
  'tt',
  'haw',
  'ln',
  'ha',
  'ba',
  'jw',
  'su',
];

export const modelRegistry: LocalModelManifest[] = [
  {
    id: 'cactus-whistle',
    type: 'stt',
    runtime: 'cactus-needle',
    downloadUrl: 'https://huggingface.co/Cactus-Compute/whistle',
    repoId: 'Cactus-Compute/whistle',
    revision: 'b358ddadd89b7a713b5aa131f23032d3cca1b251',
    files: ['whistle.cact'],
    fileSha256: {
      'whistle.cact':
        'b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb',
    },
    sha256: '',
    sizeMb: 17,
    streaming: false,
    languages: ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl'],
    languageDetection: 'selectable',
    license: 'apache-2.0',
    minRamGb: 1,
    notes:
      'Compact seven-language Whistle via Cactus Needle. Final text after each phrase; audio stays local. No whole-meeting length limit.',
    releaseState: 'ready',
  },
  {
    id: 'whisper-tiny-q5-cpp',
    type: 'stt',
    runtime: 'whisper.cpp',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp',
    repoId: 'ggerganov/whisper.cpp',
    revision: '5359861c739e955e79d9a303bcbc70fb988958b1',
    files: ['ggml-tiny-q5_1.bin'],
    fileSha256: {
      'ggml-tiny-q5_1.bin':
        '818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7',
    },
    sha256: '',
    sizeMb: 31,
    streaming: false,
    languages: [...WHISPER_LANGUAGES],
    languageDetection: 'selectable',
    license: 'mit',
    minRamGb: 1,
    notes:
      'Multilingual Whisper tiny Q5_1 via whisper.cpp. Phrase-final captions with optional language selection. Device minimum is not measured runtime RAM.',
    releaseState: 'ready',
  },
  {
    id: 'whisper-base-q5-cpp',
    type: 'stt',
    runtime: 'whisper.cpp',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp',
    repoId: 'ggerganov/whisper.cpp',
    revision: '5359861c739e955e79d9a303bcbc70fb988958b1',
    files: ['ggml-base-q5_1.bin'],
    fileSha256: {
      'ggml-base-q5_1.bin':
        '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
    },
    sha256: '',
    sizeMb: 57,
    streaming: false,
    languages: [...WHISPER_LANGUAGES],
    languageDetection: 'selectable',
    license: 'mit',
    minRamGb: 1,
    notes:
      'Multilingual Whisper base Q5_1 via whisper.cpp. Phrase-final captions with optional language selection. Device minimum is not measured runtime RAM.',
    releaseState: 'ready',
  },
  {
    id: 'whisper-small-q5-cpp',
    type: 'stt',
    runtime: 'whisper.cpp',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp',
    repoId: 'ggerganov/whisper.cpp',
    revision: '5359861c739e955e79d9a303bcbc70fb988958b1',
    files: ['ggml-small-q5_1.bin'],
    fileSha256: {
      'ggml-small-q5_1.bin':
        'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
    },
    sha256: '',
    sizeMb: 181,
    streaming: false,
    languages: [...WHISPER_LANGUAGES],
    languageDetection: 'selectable',
    license: 'mit',
    minRamGb: 2,
    notes:
      'Multilingual Whisper small Q5_1 via whisper.cpp. Phrase-final captions with optional language selection. Device minimum is not measured runtime RAM.',
    releaseState: 'ready',
  },
  {
    id: 'whisper-medium-q5-cpp',
    type: 'stt',
    runtime: 'whisper.cpp',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp',
    repoId: 'ggerganov/whisper.cpp',
    revision: '5359861c739e955e79d9a303bcbc70fb988958b1',
    files: ['ggml-medium-q5_0.bin'],
    fileSha256: {
      'ggml-medium-q5_0.bin':
        '19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f',
    },
    sha256: '',
    sizeMb: 514,
    streaming: false,
    languages: [...WHISPER_LANGUAGES],
    languageDetection: 'selectable',
    license: 'mit',
    minRamGb: 4,
    notes:
      'Multilingual Whisper medium Q5_0 via whisper.cpp. Phrase-final captions with optional language selection. Device minimum is not measured runtime RAM.',
    releaseState: 'ready',
  },
  {
    id: 'whisper-large-v3-q5-cpp',
    type: 'stt',
    runtime: 'whisper.cpp',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp',
    repoId: 'ggerganov/whisper.cpp',
    revision: '5359861c739e955e79d9a303bcbc70fb988958b1',
    files: ['ggml-large-v3-q5_0.bin'],
    fileSha256: {
      'ggml-large-v3-q5_0.bin':
        'd75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1',
    },
    sha256: '',
    sizeMb: 1031,
    streaming: false,
    languages: [...WHISPER_LANGUAGES, 'yue'],
    languageDetection: 'selectable',
    license: 'mit',
    minRamGb: 6,
    notes:
      'Multilingual Whisper large-v3 Q5_0 via whisper.cpp. Phrase-final captions with optional language selection. Device minimum is not measured runtime RAM.',
    releaseState: 'ready',
  },
  {
    id: 'all-minilm-l6-v2-embedding',
    type: 'embedding',
    runtime: 'onnxruntime',
    downloadUrl: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2',
    repoId: 'Xenova/all-MiniLM-L6-v2',
    revision: 'main',
    files: [
      'config.json',
      'onnx/model_quantized.onnx',
      'special_tokens_map.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'vocab.txt',
    ],
    sha256: '',
    sizeMb: 32,
    streaming: false,
    languages: ['en-US'],
    license: 'apache-2.0',
    minRamGb: 2,
    notes:
      'Small local semantic embedding model for offline workspace search. Keep it separate from the text and STT models so low-RAM devices can fall back to keyword ranking.',
    releaseState: 'ready',
  },
  {
    id: 'sherpa-nemotron-3.5-streaming-560ms-int8',
    type: 'stt',
    runtime: 'sherpa-onnx',
    downloadUrl:
      'https://huggingface.co/csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11',
    repoId:
      'csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11',
    revision: 'ab43d895f5985b1bbab8b6eac8607fcdc05343f3',
    files: [
      'decoder.int8.onnx',
      'encoder.int8.onnx',
      'joiner.int8.onnx',
      'tokens.txt',
    ],
    fileSha256: {
      'decoder.int8.onnx':
        '19f9c98fc6d0a2c33a65a43b36fdb2e914c26c0aa9764be3aebc502a1e982fb0',
      'encoder.int8.onnx':
        '012e9321373af99021415e0b0eb3ec827b4be3153be6f30d9b448fe65e896e68',
      'joiner.int8.onnx':
        '4101c7c679a0bc30483794b27a059e34e79232aa2068d78d51231a22c8b0d7ce',
      'tokens.txt':
        '729cc103155bafa785f9cd45746cd41cabe97eab7182fc04d594129587958f8a',
    },
    sha256: '',
    sizeMb: 651,
    streaming: true,
    languages: [
      'ar-AR',
      'bg-BG',
      'cs-CZ',
      'da-DK',
      'de-DE',
      'en-GB',
      'en-US',
      'es-ES',
      'es-US',
      'et-EE',
      'fi-FI',
      'fr-CA',
      'fr-FR',
      'hi-IN',
      'hr-HR',
      'hu-HU',
      'it-IT',
      'ja-JP',
      'ko-KR',
      'nb-NO',
      'nl-NL',
      'pl-PL',
      'pt-BR',
      'pt-PT',
      'ro-RO',
      'ru-RU',
      'sk-SK',
      'sv-SE',
      'tr-TR',
      'uk-UA',
      'vi-VN',
      'zh-CN',
    ],
    languageDetection: 'automatic',
    sherpaKind: 'nemotron-streaming',
    license: 'openmdw-1.1',
    minRamGb: 4,
    notes:
      "Fast native sherpa-onnx streaming path across Nemotron's 32 out-of-box locales. Defaults to built-in Auto; a selected locale prompts each stream. No separate language detector is loaded. Detected-language metadata remains unknown because the Node binding strips Nemotron's own tag.",
    releaseState: 'ready',
  },
  {
    id: 'sherpa-parakeet-tdt-0.6b-v3-int8',
    type: 'stt',
    runtime: 'sherpa-onnx',
    downloadUrl:
      'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    repoId: 'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    revision: '2bda32ec70b097a55adaa07d9a7173915b43cc78',
    files: [
      'decoder.int8.onnx',
      'encoder.int8.onnx',
      'joiner.int8.onnx',
      'tokens.txt',
    ],
    fileSha256: {
      'decoder.int8.onnx':
        '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e',
      'encoder.int8.onnx':
        'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247',
      'joiner.int8.onnx':
        '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3',
      'tokens.txt':
        'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d',
    },
    sha256: '',
    sizeMb: 640,
    streaming: false,
    languages: [
      'bg',
      'cs',
      'da',
      'de',
      'el',
      'en',
      'es',
      'et',
      'fi',
      'fr',
      'hr',
      'hu',
      'it',
      'lt',
      'lv',
      'mt',
      'nl',
      'pl',
      'pt',
      'ro',
      'ru',
      'sk',
      'sl',
      'sv',
      'uk',
    ],
    languageDetection: 'automatic',
    sherpaKind: 'parakeet-offline',
    license: 'cc-by-4.0',
    minRamGb: 4,
    notes:
      'Fast native sherpa-onnx Parakeet TDT v3 final-per-utterance model with punctuation and token timestamps. Model attribution is required.',
    releaseState: 'ready',
  },
  {
    id: 'cohere-transcribe-03-2026-onnx',
    type: 'stt',
    runtime: 'sherpa-onnx',
    downloadUrl:
      'https://huggingface.co/csukuangfj2/sherpa-onnx-cohere-transcribe-14-lang-int8-2026-04-01',
    repoId: 'csukuangfj2/sherpa-onnx-cohere-transcribe-14-lang-int8-2026-04-01',
    revision: '156a470cf08eefe706a0004f3c52d9ee567ca7a0',
    files: [
      'decoder.int8.onnx',
      'encoder.int8.onnx',
      'encoder.int8.onnx.data',
      'tokens.txt',
    ],
    fileSha256: {
      'decoder.int8.onnx':
        '8372ca6c8ff4db8b916ca3592f5c757a715e691b9edec751ba19b29fc854baf9',
      'encoder.int8.onnx':
        'cf704f8cfa90e3f0a76f9ffc05998bdf00ba9ae983192c14a85a3a5eb008b367',
      'encoder.int8.onnx.data':
        'bcf1b7148c8518ae52df1ad2d2fc2b4e89261ea23e6c874eef1d9f55bcbaa4a3',
      'tokens.txt':
        '013ede043ae2480e3a9205cc34550d9686100cc682bacc90f702facdfbb93035',
    },
    sha256: '',
    sizeMb: 2754,
    streaming: false,
    languages: [
      'ar',
      'de',
      'el',
      'en',
      'es',
      'fr',
      'it',
      'ja',
      'ko',
      'nl',
      'pl',
      'pt',
      'vi',
      'zh',
    ],
    languageDetection: 'automatic',
    languageDetectorModelId: 'whisper-tiny-en-onnx-q4',
    languageDetectorRequired: true,
    sherpaKind: 'cohere-offline',
    license: 'apache-2.0',
    minRamGb: 8,
    notes:
      "Native sherpa-onnx Cohere Transcribe with punctuation and inverse text normalization. A shared multilingual Whisper Tiny detector selects one of Cohere's 14 supported languages per utterance.",
    releaseState: 'ready',
  },
  {
    id: 'whisper-tiny-en-onnx-q4',
    type: 'stt',
    runtime: 'sherpa-onnx',
    downloadUrl: 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-tiny',
    repoId: 'csukuangfj/sherpa-onnx-whisper-tiny',
    revision: '65176e2deb88badc814a94058666cadccc29b61c',
    files: [
      'tiny-decoder.int8.onnx',
      'tiny-encoder.int8.onnx',
      'tiny-tokens.txt',
    ],
    fileSha256: {
      'tiny-decoder.int8.onnx':
        'd2fece8dd42771f1df975c6c0445770d0c292bf7547c2cae04a6c0cc57540925',
      'tiny-encoder.int8.onnx':
        'd24fb083ae3b1041fc24e97971d60e280c9342201fbb67b0ab428a8b4a51a434',
      'tiny-tokens.txt':
        'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126',
    },
    sha256: '',
    sizeMb: 99,
    streaming: false,
    languages: ['multilingual'],
    languageDetection: 'automatic',
    sherpaKind: 'whisper-offline',
    license: 'mit',
    minRamGb: 2,
    notes:
      'Fast native multilingual Whisper Tiny. Automatically detects the spoken language and also supplies Cohere language identification.',
    releaseState: 'ready',
  },
  {
    id: 'moonshine-base-onnx-q4',
    type: 'stt',
    runtime: 'sherpa-onnx',
    downloadUrl:
      'https://huggingface.co/csukuangfj2/sherpa-onnx-moonshine-base-en-quantized-2026-02-27',
    repoId: 'csukuangfj2/sherpa-onnx-moonshine-base-en-quantized-2026-02-27',
    revision: '8f4d6c58c03d40bcea40043bb7120a878f2bbef6',
    files: ['decoder_model_merged.ort', 'encoder_model.ort', 'tokens.txt'],
    fileSha256: {
      'decoder_model_merged.ort':
        'd9d7b333af34bc552580576ddcf248a1c6c839e0d3b43b09afb9376ed009899d',
      'encoder_model.ort':
        '7c66495948d0d08ec1af454cd4b5514862ae6511e94712a60e6d83eaec8dc8cf',
      'tokens.txt':
        '2870d843e14c1e187bf1913a521562a63b53933814bd7f2145120468f494a049',
    },
    sha256: '',
    sizeMb: 135,
    streaming: false,
    languages: ['en'],
    languageDetection: 'fixed',
    sherpaKind: 'moonshine-offline',
    license: 'mit',
    minRamGb: 4,
    notes:
      'Compact native sherpa-onnx Moonshine v2 English model for low-latency final transcripts.',
    releaseState: 'ready',
  },
  {
    id: 'distil-whisper-large-v3-5-onnx-q4',
    type: 'stt',
    runtime: 'sherpa-onnx',
    downloadUrl:
      'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-distil-large-v3.5',
    repoId: 'csukuangfj/sherpa-onnx-whisper-distil-large-v3.5',
    revision: '2933155a51e982b9ebd9ca3b7fb80fc78162fa64',
    files: [
      'distil-large-v3.5-decoder.int8.onnx',
      'distil-large-v3.5-encoder.int8.onnx',
      'distil-large-v3.5-tokens.txt',
    ],
    fileSha256: {
      'distil-large-v3.5-decoder.int8.onnx':
        '7cef98c7b5491ba52a520fd61da957a62e6e64c702c6c8aeac8cdfb146cbdb6a',
      'distil-large-v3.5-encoder.int8.onnx':
        'c30727100ba2dfbe64f2309a2ec44a5049b005d8a6c0acce49952f635083cbdb',
      'distil-large-v3.5-tokens.txt':
        'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126',
    },
    sha256: '',
    sizeMb: 939,
    streaming: false,
    languages: ['en'],
    languageDetection: 'fixed',
    sherpaKind: 'distil-whisper-offline',
    license: 'mit',
    minRamGb: 8,
    notes:
      'Higher-accuracy native sherpa-onnx English model for final-per-utterance and post-meeting transcription.',
    releaseState: 'ready',
  },
  {
    id: 'gemma-4-e2b-it-onnx-q4f16',
    type: 'text',
    usageGuidance:
      'General chat, writing and summaries. Uses more memory than the compact options.',
    runtime: 'onnxruntime',
    tier: 'small',
    downloadUrl: 'https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX',
    repoId: 'onnx-community/gemma-4-E2B-it-ONNX',
    revision: 'main',
    files: [
      'chat_template.jinja',
      'config.json',
      'generation_config.json',
      'onnx/decoder_model_merged_q4f16.onnx',
      'onnx/decoder_model_merged_q4f16.onnx_data',
      'onnx/embed_tokens_q4f16.onnx',
      'onnx/embed_tokens_q4f16.onnx_data',
      'tokenizer.json',
      'tokenizer_config.json',
    ],
    fileSha256: {
      'onnx/decoder_model_merged_q4f16.onnx':
        '73c0f1fe04f9a3a048fb3319c0671b6cf0346bf33a3a8624c853bcffe01c24a4',
      'onnx/decoder_model_merged_q4f16.onnx_data':
        '3b27245a7396cb7039a4e4118bd2a8aa35106bae381522edf7c4867b5f22bb10',
      'onnx/embed_tokens_q4f16.onnx':
        'd7ca53f6a169471b5699b2f57ee4c7aa2c73732b0152f3909e64b71384444825',
      'onnx/embed_tokens_q4f16.onnx_data':
        '024b199e6358ed42970f807686add5f9430d7e254ca7ce22fc9c83f015b9c517',
      'tokenizer.json':
        '47bd35616c7c782aaca6ccf48c75f3461d5877170984b8836b375107d0a9f566',
    },
    sha256: '',
    sizeMb: 3131,
    contextWindowTokens: 131072,
    streaming: true,
    languages: ['en-US'],
    license: 'apache-2.0',
    minRamGb: 8,
    notes:
      'Local Nota AI text tier. Uses q4f16 text-only Gemma 4 ONNX files because the q2 mobile package is not supported by the current Node ONNX Runtime.',
    releaseState: 'ready',
  },
  {
    id: 'lfm2.5-230m-onnx-q4',
    type: 'text',
    usageGuidance:
      'Fast rewrites and simple extraction. Tool tasks can fail or invent details; prefer a larger model for agent work.',
    runtime: 'onnxruntime',
    tier: 'small',
    downloadUrl: 'https://huggingface.co/LiquidAI/LFM2.5-230M-ONNX',
    repoId: 'LiquidAI/LFM2.5-230M-ONNX',
    revision: 'c6f46e4e3f885ebcad164d14059a49f90e27eb4d',
    files: [
      'chat_template.jinja',
      'config.json',
      'generation_config.json',
      'onnx/model_q4.onnx',
      'onnx/model_q4.onnx_data',
      'tokenizer.json',
      'tokenizer_config.json',
    ],
    fileSha256: {
      'chat_template.jinja':
        '6d65c8804847ad74eea912dd7eca3dc1cf7a457b53a77f47d841a14121910963',
      'config.json':
        'c09361ba08a21a464011710ade1bab1dbe7a9c43eadb70cae04ebb4825ff8233',
      'generation_config.json':
        '85fa3172f3838eefa602843e3d97fbf532aeb585e0d7fb869dcd17c268e77f45',
      'onnx/model_q4.onnx':
        '82a442c44d3d143432edff57984a4e7e8da65179d3a960a170d294aed8c5dd8d',
      'onnx/model_q4.onnx_data':
        'b51a4580a88a2cd0486032cfdaf8694b09359abca5a97df8deb0a314ea6e5b34',
      'tokenizer.json':
        'df1d8d5ec5d091b460562ffd545e4a5e91d17d4a0db7ebe733be34ed374377bd',
      'tokenizer_config.json':
        'c46e3f5715c73f7ae9beeeebad8f7187fd647d2de352c3cd01fe250c88d2f960',
    },
    sha256: '',
    sizeMb: 217,
    streaming: true,
    languages: ['en', 'ar', 'zh', 'fr', 'de', 'ja', 'ko', 'es', 'pt', 'it'],
    license: 'lfm1.0',
    minRamGb: 2,
    contextWindowTokens: 32768,
    notes:
      'Official LiquidAI export under the LFM 1.0 license, which has a commercial revenue threshold. Uses the published context limit.',
    releaseState: 'ready',
  },
  {
    id: 'lfm2.5-350m-onnx-q4f16',
    type: 'text',
    usageGuidance:
      'Fast formatting and simple extraction. Tool tasks can fail; prefer a larger model for agent work.',
    runtime: 'onnxruntime',
    tier: 'small',
    downloadUrl: 'https://huggingface.co/LiquidAI/LFM2.5-350M-ONNX',
    repoId: 'LiquidAI/LFM2.5-350M-ONNX',
    revision: 'd11593fd9eb408e322667926656598896c2d5ff9',
    files: [
      'chat_template.jinja',
      'config.json',
      'generation_config.json',
      'onnx/model_q4f16.onnx',
      'onnx/model_q4f16.onnx_data',
      'tokenizer.json',
      'tokenizer_config.json',
    ],
    fileSha256: {
      'chat_template.jinja':
        '013eed60546434b6967e3483153d8c5c37abcb1d667f8b1f914683f2a9411531',
      'config.json':
        '544d8d604bacf4cb89383c49c9a54621afa26a6741f3f55fd8b840ca1d640419',
      'generation_config.json':
        '94bfac0e1c207691baf4e172389a8efb114f8b60eb3a5c07a2f418aefa8f8bb6',
      'onnx/model_q4f16.onnx':
        '3012c28a119828561c90196331435d91c43c1a6ab4898ac79715585fff1dff85',
      'onnx/model_q4f16.onnx_data':
        '9256ecd417b801b441d926ebe5ead4ebf50ac1a5a0f8f7914cf60d9d6452ef69',
      'tokenizer.json':
        '29d43b4be8e8a896fefd7cd836ca6d6b4eedd249f823866ce0453b368e646f49',
      'tokenizer_config.json':
        '95c85d0860d06c9529345f386004e8e67743375b15c5d39e9f46427d8977577b',
    },
    sha256: '',
    sizeMb: 259,
    streaming: true,
    languages: ['en', 'ja', 'ko', 'fr', 'es', 'de', 'it', 'pt', 'ar', 'zh'],
    license: 'lfm1.0',
    minRamGb: 2,
    contextWindowTokens: 32768,
    notes:
      'Official LiquidAI export under the LFM 1.0 license, which has a commercial revenue threshold. Uses the published context limit.',
    releaseState: 'ready',
  },
  {
    id: 'qwen3.5-0.8b-onnx-q4f16',
    type: 'text',
    usageGuidance:
      'Compact chat and rewrites. May omit summary details or repeat tool calls; prefer 2B for agent work.',
    runtime: 'onnxruntime',
    tier: 'small',
    downloadUrl: 'https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX',
    repoId: 'onnx-community/Qwen3.5-0.8B-ONNX',
    revision: 'c0d619322dad7c4441a8841a53fc59772ddddcc0',
    files: [
      'chat_template.jinja',
      'config.json',
      'generation_config.json',
      'onnx/decoder_model_merged_q4f16.onnx',
      'onnx/decoder_model_merged_q4f16.onnx_data',
      'onnx/embed_tokens_q4f16.onnx',
      'onnx/embed_tokens_q4f16.onnx_data',
      'preprocessor_config.json',
      'processor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
    ],
    fileSha256: {
      'chat_template.jinja':
        '273d8e0e683b885071fb17e08d71e5f2a5ddfb5309756181681de4f5a1822d80',
      'config.json':
        '36fed6a902ccd06ef19a452bd5a0750bd88fe347d06ab75ef515615bac5b296d',
      'generation_config.json':
        'dc0cbe66543f310896469b7b1448af792f403293a1080baaf04d586c57b23e48',
      'onnx/decoder_model_merged_q4f16.onnx':
        '34e17c8e2035919df86ab1f52b41999a1bd18ba96b49dba6ac8d340aae652006',
      'onnx/decoder_model_merged_q4f16.onnx_data':
        '468cf83a51e81e27ffb4210268b1b09979e68dd128ad5fe347e5d08721cecc41',
      'onnx/embed_tokens_q4f16.onnx':
        '8218531ac44ae9978d50647f1d907c53c308f758514b992504238c77843c254d',
      'onnx/embed_tokens_q4f16.onnx_data':
        'ec4a1f13ff942653b52000a7a0ec40504110d8be9a0ecab2da4d3063588ed563',
      'preprocessor_config.json':
        '6a970fd06f30e6943b3e2c14d5d3b42d49b06cf99b99103d56689bef462d90f8',
      'processor_config.json':
        '14932921ca485d458a04dafd8069fbb0a4505622a48208d19ed247115801385b',
      'tokenizer.json':
        '89da80cc6689bef4d90cc1028249436975ffb0814618f1d93c65310e05801a9b',
      'tokenizer_config.json':
        'fccbff64ebe09343aa2171028657f5b038db96fb4f657609bc76743eddfa3b9d',
    },
    sha256: '',
    sizeMb: 604,
    streaming: true,
    languages: [
      'en',
      'es',
      'fr',
      'de',
      'it',
      'pt',
      'zh',
      'ja',
      'ko',
      'ar',
      'hi',
      'ru',
      'id',
      'vi',
      'th',
      'pl',
      'nl',
      'tr',
    ],
    license: 'apache-2.0',
    minRamGb: 4,
    contextWindowTokens: 262144,
    notes:
      'Standard text-only export; the OPT decoder requires operators unavailable in Node ONNX Runtime 1.24.3.',
    releaseState: 'ready',
  },
  {
    id: 'lfm2.5-1.2b-instruct-onnx-q4f16',
    type: 'text',
    usageGuidance:
      'Fast writing and summaries with low memory use. Review results on complex tasks.',
    runtime: 'onnxruntime',
    tier: 'small',
    downloadUrl: 'https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-ONNX',
    repoId: 'LiquidAI/LFM2.5-1.2B-Instruct-ONNX',
    revision: '10f72e70abf67ac0fd7ebf15bc5854726891d864',
    files: [
      'chat_template.jinja',
      'config.json',
      'generation_config.json',
      'onnx/model_q4f16.onnx',
      'onnx/model_q4f16.onnx_data',
      'tokenizer.json',
      'tokenizer_config.json',
    ],
    fileSha256: {
      'chat_template.jinja':
        'f05bf4b967dc993bdc7a2fe6e43759ee218eb0eb340d68b063e1c4f8ad148176',
      'config.json':
        'dd5d4c6e32a992ad7ddac5c07f5e4711e42c69125f2b94287af7a8ec19963be5',
      'generation_config.json':
        '25f750b7e6a790f86ed01cd6f128f905152cb60bbfe2e6618ceca833b452cf80',
      'onnx/model_q4f16.onnx':
        'a9986ad188200507342ac32f727aa4691edb5428b0aa8c4a9fbdf0c85a6fe667',
      'onnx/model_q4f16.onnx_data':
        '46cfacc12941150620a3f644a5269e9baebd75d681cfa09cadeef71b8ed64ac2',
      'tokenizer.json':
        '0a1f2cb9fc2769030ca1f4207e81c1af493319373d41b8d3cf5be53860c13760',
      'tokenizer_config.json':
        '0f11f4ffa5750369414bb24e41f26e2bbf23f1d01def533cad5f584e59ae3bef',
    },
    sha256: '',
    sizeMb: 764,
    streaming: true,
    languages: ['en', 'ja', 'ko', 'fr', 'es', 'de', 'it', 'pt', 'ar', 'zh'],
    license: 'lfm1.0',
    minRamGb: 4,
    contextWindowTokens: 32768,
    notes:
      'Official LiquidAI export under the LFM 1.0 license, which has a commercial revenue threshold. Uses the published context limit.',
    releaseState: 'ready',
  },
  {
    id: 'qwen3.5-2b-onnx-q4f16',
    type: 'text',
    usageGuidance:
      'Recommended balance for chat, summaries and tool use. Review proposed changes before applying them.',
    runtime: 'onnxruntime',
    tier: 'medium',
    downloadUrl: 'https://huggingface.co/onnx-community/Qwen3.5-2B-ONNX',
    repoId: 'onnx-community/Qwen3.5-2B-ONNX',
    revision: 'b1fc7ca3afafcb8e4b13d29715a6b9ea5af1d1cb',
    files: [
      'chat_template.jinja',
      'config.json',
      'generation_config.json',
      'onnx/decoder_model_merged_q4f16.onnx',
      'onnx/decoder_model_merged_q4f16.onnx_data',
      'onnx/embed_tokens_q4f16.onnx',
      'onnx/embed_tokens_q4f16.onnx_data',
      'preprocessor_config.json',
      'processor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
    ],
    fileSha256: {
      'chat_template.jinja':
        '273d8e0e683b885071fb17e08d71e5f2a5ddfb5309756181681de4f5a1822d80',
      'config.json':
        'b028de63b0ed8b37107acaaf1475d40d6d4feb5721153674e7d1d0bdbfd0f258',
      'generation_config.json':
        'dc0cbe66543f310896469b7b1448af792f403293a1080baaf04d586c57b23e48',
      'onnx/decoder_model_merged_q4f16.onnx':
        'aff64289c18b527ee16963444be405d08e7211c4fdca6f3fe53d9d4586703bf7',
      'onnx/decoder_model_merged_q4f16.onnx_data':
        'e0d1375a8d30aa7db927ce05c60c4134345dca61150acdf05b9822bc06c7e54b',
      'onnx/embed_tokens_q4f16.onnx':
        '802a072ff21f540eda7f343aa71dbb0354c8859caaf34f09b3bf8117725d7de8',
      'onnx/embed_tokens_q4f16.onnx_data':
        '650aa8eb39b7404ca2c908d78243c82b6fd88321feeb8fca175745806c6b3a81',
      'preprocessor_config.json':
        '6a970fd06f30e6943b3e2c14d5d3b42d49b06cf99b99103d56689bef462d90f8',
      'processor_config.json':
        '14932921ca485d458a04dafd8069fbb0a4505622a48208d19ed247115801385b',
      'tokenizer.json':
        '89da80cc6689bef4d90cc1028249436975ffb0814618f1d93c65310e05801a9b',
      'tokenizer_config.json':
        'fccbff64ebe09343aa2171028657f5b038db96fb4f657609bc76743eddfa3b9d',
    },
    sha256: '',
    sizeMb: 1405,
    streaming: true,
    languages: [
      'en',
      'es',
      'fr',
      'de',
      'it',
      'pt',
      'zh',
      'ja',
      'ko',
      'ar',
      'hi',
      'ru',
      'id',
      'vi',
      'th',
      'pl',
      'nl',
      'tr',
    ],
    license: 'apache-2.0',
    minRamGb: 8,
    contextWindowTokens: 262144,
    notes:
      'Standard text-only export; the OPT decoder requires operators unavailable in Node ONNX Runtime 1.24.3.',
    releaseState: 'ready',
  },
  {
    id: 'lfm2.5-2.6b-onnx-q4f16',
    type: 'text',
    usageGuidance:
      'Optional reasoning model. Thinks before answering, so expect longer waits.',
    runtime: 'onnxruntime',
    tier: 'medium',
    downloadUrl: 'https://huggingface.co/LiquidAI/LFM2.5-2.6B-ONNX',
    repoId: 'LiquidAI/LFM2.5-2.6B-ONNX',
    revision: '66826372fd4fa166f53be0371c9315745c07cace',
    files: [
      'chat_template.jinja',
      'config.json',
      'generation_config.json',
      'onnx/model_q4f16.onnx',
      'onnx/model_q4f16.onnx_data',
      'onnx/model_q4f16.onnx_data_1',
      'tokenizer.json',
      'tokenizer_config.json',
    ],
    fileSha256: {
      'chat_template.jinja':
        '8ea15224003c2e89a1ac8d3b0a3362e8e587896f2bcc41df5dcc2d9c5d0ee82c',
      'config.json':
        '3df9ebb278bf43eddd8a240086449f197976a1783d6c4d2bfe9eaec4920f4184',
      'generation_config.json':
        'e5e1e91829a9ae65809b578bff350dca876febbda88a9e36f415b002f6b3ddf0',
      'onnx/model_q4f16.onnx':
        '871354d43abc0d718a7a089d2fe10ad5d1f83e08acbfb9f45e4d137b41a1e9a4',
      'onnx/model_q4f16.onnx_data':
        '34537bf4a6d70ddf1627bd3709d31c8b7db8d5bcaee2098c45661be59476fbec',
      'onnx/model_q4f16.onnx_data_1':
        '1b645b44902caccd406098c4dbef5724927c5fb2a2be4a087ae328989b111a7f',
      'tokenizer.json':
        '695be7802a0e4b8a81048f0ff5ebb7fc811a0ba5a6be63dbb24deb5a81096f41',
      'tokenizer_config.json':
        'cf46c3cdb18cf88542ee0d5d2afd98d78b3eeffd0e6d00a26f8b76800ff9a446',
    },
    sha256: '',
    sizeMb: 1553,
    streaming: true,
    languages: [
      'ar',
      'zh',
      'en',
      'fr',
      'de',
      'hi',
      'id',
      'it',
      'ja',
      'ko',
      'pl',
      'pt',
      'ru',
      'es',
      'th',
      'vi',
    ],
    license: 'lfm1.0',
    minRamGb: 8,
    contextWindowTokens: 128000,
    notes:
      'Always thinks before answering and needs a larger output budget. Optional reasoning model under the LFM 1.0 license, which has a commercial revenue threshold.',
    releaseState: 'ready',
  },
  {
    id: 'qwen3.5-4b-onnx-q4f16',
    type: 'text',
    usageGuidance:
      'Larger option for demanding chat and tool tasks. Uses more memory and takes longer to answer.',
    runtime: 'onnxruntime',
    tier: 'medium',
    downloadUrl: 'https://huggingface.co/onnx-community/Qwen3.5-4B-ONNX',
    repoId: 'onnx-community/Qwen3.5-4B-ONNX',
    revision: '74d8caba2117fd5f41d655e9cc27eda1338662b3',
    files: [
      'chat_template.jinja',
      'config.json',
      'generation_config.json',
      'onnx/decoder_model_merged_q4f16.onnx',
      'onnx/decoder_model_merged_q4f16.onnx_data',
      'onnx/decoder_model_merged_q4f16.onnx_data_1',
      'onnx/embed_tokens_q4f16.onnx',
      'onnx/embed_tokens_q4f16.onnx_data',
      'preprocessor_config.json',
      'processor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
    ],
    fileSha256: {
      'chat_template.jinja':
        'a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715',
      'config.json':
        'c6f9834460177e3821e035900320fa24bd11ad1c9f14bfe2e78e4398e38c4937',
      'generation_config.json':
        'dc0cbe66543f310896469b7b1448af792f403293a1080baaf04d586c57b23e48',
      'onnx/decoder_model_merged_q4f16.onnx':
        '61b653b72f301d1ff503910d23f67ee062e41195257c874e2ef5b73e36cc00b5',
      'onnx/decoder_model_merged_q4f16.onnx_data':
        '846fad79745d84482f8baba2d5db2d907ce42704c1b0323a3467a52288c4165b',
      'onnx/decoder_model_merged_q4f16.onnx_data_1':
        'fc1bb145d8839272a87c71e0cb4d34832a0d7bb4de06ab4fb74fea1aa6ddf7e5',
      'onnx/embed_tokens_q4f16.onnx':
        '0e5fe965e5575b6428b7dea82661ed09bf7abadf29450c279e46e8113745110e',
      'onnx/embed_tokens_q4f16.onnx_data':
        'fc1bb145d8839272a87c71e0cb4d34832a0d7bb4de06ab4fb74fea1aa6ddf7e5',
      'preprocessor_config.json':
        '6a970fd06f30e6943b3e2c14d5d3b42d49b06cf99b99103d56689bef462d90f8',
      'processor_config.json':
        '14932921ca485d458a04dafd8069fbb0a4505622a48208d19ed247115801385b',
      'tokenizer.json':
        '89da80cc6689bef4d90cc1028249436975ffb0814618f1d93c65310e05801a9b',
      'tokenizer_config.json':
        '2de621ec071dd61438efdd6d0183bd3d612e98d05ac10d19ed75f1fef9299bc9',
    },
    sha256: '',
    sizeMb: 2823,
    streaming: true,
    languages: [
      'en',
      'es',
      'fr',
      'de',
      'it',
      'pt',
      'zh',
      'ja',
      'ko',
      'ar',
      'hi',
      'ru',
      'id',
      'vi',
      'th',
      'pl',
      'nl',
      'tr',
    ],
    license: 'apache-2.0',
    minRamGb: 12,
    contextWindowTokens: 262144,
    notes:
      'Standard text-only export; the OPT decoder requires operators unavailable in Node ONNX Runtime 1.24.3.',
    releaseState: 'ready',
  },
  {
    id: 'gemma-4-e4b-it-onnx-q4f16',
    type: 'text',
    usageGuidance:
      'Larger option for writing, summaries and complex tasks. Best on devices with more memory.',
    runtime: 'onnxruntime',
    tier: 'medium',
    downloadUrl: 'https://huggingface.co/onnx-community/gemma-4-E4B-it-ONNX',
    repoId: 'onnx-community/gemma-4-E4B-it-ONNX',
    revision: 'main',
    files: [
      'chat_template.jinja',
      'config.json',
      'generation_config.json',
      'onnx/decoder_model_merged_q4f16.onnx',
      'onnx/decoder_model_merged_q4f16.onnx_data',
      'onnx/decoder_model_merged_q4f16.onnx_data_1',
      'onnx/embed_tokens_q4f16.onnx',
      'onnx/embed_tokens_q4f16.onnx_data',
      'tokenizer.json',
      'tokenizer_config.json',
    ],
    fileSha256: {
      'onnx/decoder_model_merged_q4f16.onnx':
        '43aa27452be3dd7fbb9524257dd66af957add748ddab20ea63ae71923e59aa08',
      'onnx/decoder_model_merged_q4f16.onnx_data':
        'b6aa13eab3ecdf4721293e93c806c279ca0516956187f7aec63ee90ec7216e73',
      'onnx/decoder_model_merged_q4f16.onnx_data_1':
        '84e1c5f09ba88a5351959e4f73f62bce46f92dc19a7d7c82376ef36771c26a30',
      'onnx/embed_tokens_q4f16.onnx':
        'aa48aa1806eda0ea42b79cd8eea355aebaf3b6ae3b04190bfee7ceef308603a4',
      'onnx/embed_tokens_q4f16.onnx_data':
        'fd0f39c08f7e20a31145c2351a76a408b6c4ab60d15cc33f40e29cf30c0b2451',
      'tokenizer.json':
        '47bd35616c7c782aaca6ccf48c75f3461d5877170984b8836b375107d0a9f566',
    },
    sha256: '',
    sizeMb: 4925,
    contextWindowTokens: 131072,
    streaming: true,
    languages: ['en-US'],
    license: 'apache-2.0',
    minRamGb: 16,
    notes: 'Stronger local Nota AI text tier after device health passes.',
    releaseState: 'ready',
  },
  {
    id: 'smollm3-3b-onnx-q4f16',
    type: 'text',
    usageGuidance:
      'General chat and writing. Tool-use quality has not been measured in Nota.',
    runtime: 'onnxruntime',
    tier: 'medium',
    downloadUrl: 'https://huggingface.co/HuggingFaceTB/SmolLM3-3B-ONNX',
    repoId: 'HuggingFaceTB/SmolLM3-3B-ONNX',
    revision: 'main',
    files: [
      'chat_template.jinja',
      'config.json',
      'generation_config.json',
      'onnx/model_q4f16.onnx',
      'onnx/model_q4f16.onnx_data',
      'special_tokens_map.json',
      'tokenizer.json',
      'tokenizer_config.json',
    ],
    sha256: '',
    sizeMb: 2137,
    contextWindowTokens: 65536,
    streaming: true,
    languages: ['en-US'],
    license: 'apache-2.0',
    minRamGb: 8,
    notes:
      'Medium curated local ONNX text model with q4f16 external data files.',
    releaseState: 'ready',
  },
];

export function getLocalModelRegistry() {
  return modelRegistry;
}

export function localModelById(modelId: string | undefined) {
  return modelRegistry.find(model => model.id === modelId) ?? null;
}

export function isLocalOnnxTextModel(modelId: string) {
  const model = localModelById(modelId);
  return model?.type === 'text' && model.runtime === 'onnxruntime';
}

export function requiredFilesFor(modelId: string) {
  return localModelById(modelId)?.files ?? [];
}

export function dtypeForLocalTextModel(modelId: string) {
  if (modelId.endsWith('-q4f16')) return 'q4f16';
  return modelId.endsWith('-q4') ? 'q4' : undefined;
}
