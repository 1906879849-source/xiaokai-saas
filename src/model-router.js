const platformSettings = require('./platform-settings');

// Static defaults remain exported for compatibility. Runtime reads come from
// the persistent admin-managed platform settings.
const MODEL_REGISTRY = {
  'GPT Image 2': {
    provider: 'otterl', id: 'gpt-image-2', taskApi: 'otterl',
    supportsResolution: true, resolutions: ['1K'], supportsImageInput: true,
  },
  'GPT Image 2 · 4K 超分': {
    provider: 'otterl', id: 'gpt-image-2-4k超分', taskApi: 'otterl', fixedResolution: '4K',
    supportsResolution: false, resolutions: ['4K'], supportsImageInput: true,
  },
  'GPT Image 2 · 原生 4K': {
    provider: 'otterl', id: 'gpt-image-2-原生4k', taskApi: 'otterl', fixedResolution: '4K',
    supportsResolution: false, resolutions: ['4K'], supportsImageInput: true,
  },
  'GPT Image 2.5 Flare': {
    provider: 'otterl', id: 'gpt-image-2.5-flare', taskApi: 'otterl',
    supportsResolution: true, resolutions: ['1K'], supportsImageInput: true,
  },
  'GPT Image 2.5 Sunburst': {
    provider: 'otterl', id: 'gpt-image-2.5-sunburst', taskApi: 'otterl',
    supportsResolution: true, resolutions: ['1K'], supportsImageInput: true,
  },
  'Gemini 3 Pro Image': {
    provider: 'otterl', id: 'gemini-3-pro-image-preview', taskApi: 'otterl',
    supportsResolution: true, resolutions: ['1K', '2K', '4K'], supportsImageInput: true,
  },
  'Gemini 3.1 Flash Image': {
    provider: 'otterl', id: 'gemini-3.1-flash-image-preview', taskApi: 'otterl',
    supportsResolution: true, resolutions: ['1K', '2K', '4K'], supportsImageInput: true,
  },
};

function resolveModel(name) {
  return platformSettings.resolveModel(name);
}

function listModels() {
  return platformSettings.publicModels();
}

module.exports = { resolveModel, listModels, MODEL_REGISTRY };
