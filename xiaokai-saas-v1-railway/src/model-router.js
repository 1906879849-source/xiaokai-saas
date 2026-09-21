const MODEL_REGISTRY = {
  'GPT Image 1.5': {
    provider: 'kie',
    id: 'gpt-image-1.5',
    family: 'gpt-image',
    supportsResolution: false,
    supportsImageInput: true,
  },
  'GPT Image 2': {
    provider: 'kie',
    id: 'gpt-image-2',
    family: 'gpt-image',
    supportsResolution: false,
    supportsImageInput: true,
  },
  'GPT Image -All': {
    provider: 'kie',
    id: 'gpt-image-all',
    family: 'gpt-image',
    supportsResolution: false,
    supportsImageInput: true,
  },
  'GPT-4o Image': {
    provider: 'kie',
    id: '4o-image',
    family: 'gpt-image',
    supportsResolution: false,
    supportsImageInput: true,
  },
  'Nano Banana': {
    provider: 'kie',
    id: 'google/nano-banana',
    family: 'nano-banana',
    supportsResolution: true,
    supportsImageInput: true,
  },
  'Nano Banana - Fal': {
    provider: 'kie',
    id: 'google/nano-banana',
    family: 'nano-banana',
    supportsResolution: true,
    supportsImageInput: true,
  },
  'Nano Banana Pro': {
    provider: 'kie',
    id: 'nano-banana-pro',
    family: 'nano-banana',
    supportsResolution: true,
    supportsImageInput: true,
  },
  'Nano Banana Pro - Fal': {
    provider: 'kie',
    id: 'nano-banana-pro',
    family: 'nano-banana',
    supportsResolution: true,
    supportsImageInput: true,
  },
  'Nano Banana 2': {
    provider: 'kie',
    id: 'nano-banana-2',
    family: 'nano-banana',
    supportsResolution: true,
    supportsImageInput: true,
  },
  'Nano Banana 2 Lite': {
    provider: 'kie',
    id: 'nano-banana-2-lite',
    family: 'nano-banana',
    supportsResolution: true,
    supportsImageInput: true,
  },
  'Nano Banana 2 - Fal': {
    provider: 'kie',
    id: 'nano-banana-2',
    family: 'nano-banana',
    supportsResolution: true,
    supportsImageInput: true,
  },
  'Gemini 2.5 Flash 官': {
    provider: 'kie',
    id: 'google/nano-banana',
    family: 'nano-banana',
    supportsResolution: true,
    supportsImageInput: true,
  },
  'Gemini 3.1 Flash 官': {
    provider: 'kie',
    id: 'nano-banana-2',
    family: 'nano-banana',
    supportsResolution: true,
    supportsImageInput: true,
  },
  'Gemini 3 Pro 官': {
    provider: 'kie',
    id: 'nano-banana-pro',
    family: 'nano-banana',
    supportsResolution: true,
    supportsImageInput: true,
  },
};

function resolveModel(name) {
  return MODEL_REGISTRY[name] || null;
}

function listModels() {
  return Object.entries(MODEL_REGISTRY).map(([name, meta]) => ({ name, ...meta }));
}

module.exports = { resolveModel, listModels, MODEL_REGISTRY };
