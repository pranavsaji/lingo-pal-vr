/**
 * Asset manifest shared by the runtime and the IWSDK editor.
 * Deterministic and side-effect free (evaluated twice, in two realms).
 */

import { AssetType, defineAssets } from '@iwsdk/core';
import { createStudioFloor } from './scene-assets/studio.scene-asset.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

const uikitml = (fileName: string, name: string) => ({
  url: publicAssetUrl(`ui/${fileName}`),
  type: AssetType.UIKitML,
  name,
});

export default defineAssets({
  'studio-floor': createStudioFloor(),
  'lesson-panel': uikitml('lesson.uikitml', 'Lesson Panel'),
  'chat-panel': uikitml('chat.uikitml', 'Chat Panel'),
  'carnet-panel': uikitml('carnet.uikitml', 'Carnet Panel'),
  'settings-panel': uikitml('settings.uikitml', 'Settings Panel'),
});
