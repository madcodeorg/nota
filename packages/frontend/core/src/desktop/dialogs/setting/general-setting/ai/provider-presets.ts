// Model IDs remain editable: SDK support does not guarantee model access or capabilities.
export const SDK_PROVIDER_PRESETS = {
  alibaba: { label: 'Alibaba', baseUrl: '', model: '', fields: [] },
  baseten: { label: 'Baseten', baseUrl: '', model: '', fields: [] },
  cerebras: { label: 'Cerebras', baseUrl: '', model: '', fields: [] },
  cohere: { label: 'Cohere', baseUrl: '', model: '', fields: [] },
  deepinfra: { label: 'DeepInfra', baseUrl: '', model: '', fields: [] },
  fireworks: { label: 'Fireworks', baseUrl: '', model: '', fields: [] },
  huggingface: { label: 'Hugging Face', baseUrl: '', model: '', fields: [] },
  minimax: { label: 'MiniMax', baseUrl: '', model: '', fields: [] },
  moonshotai: { label: 'Moonshot AI', baseUrl: '', model: '', fields: [] },
  togetherai: { label: 'Together AI', baseUrl: '', model: '', fields: [] },
  zai: { label: 'Z.ai', baseUrl: '', model: '', fields: [] },
  'ai-gateway': {
    label: 'Vercel AI Gateway',
    baseUrl: '',
    model: '',
    fields: [],
  },
  'open-responses': {
    label: 'Open Responses',
    baseUrl: '',
    model: '',
    fields: [],
  },
  azure: {
    label: 'Azure OpenAI',
    baseUrl: '',
    model: '',
    fields: ['resourceName'],
  },
  'amazon-bedrock': {
    label: 'Amazon Bedrock',
    baseUrl: '',
    model: '',
    fields: ['region'],
  },
  'google-vertex': {
    label: 'Google Vertex AI',
    baseUrl: '',
    model: '',
    fields: ['project', 'location'],
  },
  'google-vertex-anthropic': {
    label: 'Vertex Claude',
    baseUrl: '',
    model: '',
    fields: ['project', 'location'],
  },
  'google-vertex-maas': {
    label: 'Vertex Model Garden',
    baseUrl: '',
    model: '',
    fields: ['project', 'location'],
  },
  'google-vertex-xai': {
    label: 'Vertex xAI',
    baseUrl: '',
    model: '',
    fields: ['project', 'location'],
  },
  'anthropic-aws': {
    label: 'Anthropic on AWS',
    baseUrl: '',
    model: '',
    fields: ['region', 'workspaceId'],
  },
} satisfies Record<
  string,
  { label: string; baseUrl: string; model: string; fields: string[] }
>;

export function isADCOnlyProvider(provider: string) {
  return (
    provider === 'google-vertex-anthropic' ||
    provider === 'google-vertex-maas' ||
    provider === 'google-vertex-xai'
  );
}
