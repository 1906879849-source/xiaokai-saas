const platformSettings = require('./platform-settings');

// Static defaults remain exported for compatibility. Runtime reads come from
// the persistent admin-managed platform settings.
const MODEL_REGISTRY = {
  'Nano Banana 2': {
    provider: 'rivo', id: 'nano-banana-2', taskApi: 'rivo',
    supportsResolution: true, resolutions: ['1K', '2K', '4K'], supportsImageInput: true,
  },
  'Nano Banana Pro': {
    provider: 'rivo', id: 'nano-banana-pro', taskApi: 'rivo',
    supportsResolution: true, resolutions: ['1K', '2K', '4K'], supportsImageInput: true,
  },
  'GPT Image 2': {
    provider: 'rivo', id: 'gpt-image-2', taskApi: 'rivo',
    supportsResolution: true, resolutions: ['1K', '2K', '4K'], supportsImageInput: true,
  },
  'GPT Image 2.5 Flare': {
    provider: 'rivo', id: 'gpt-image-2.5-flare', taskApi: 'rivo',
    supportsResolution: true, resolutions: ['1K'], supportsImageInput: true,
  },
  'GPT Image 2.5 Sunburst': {
    provider: 'rivo', id: 'gpt-image-2.5-sunburst', taskApi: 'rivo',
    supportsResolution: true, resolutions: ['1K'], supportsImageInput: true,
  },
};

function resolveModel(name) {
  return platformSettings.resolveModel(name);
}

function listModels() {
  return platformSettings.publicModels();
}

module.exports = { resolveModel, listModels, MODEL_REGISTRY };
