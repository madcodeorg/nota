import type { Container } from '@blocksuite/affine/global/di';
import {
  FileSizeLimitProvider,
  type IFileSizeLimitService,
} from '@blocksuite/affine/shared/services';
import { Extension } from '@blocksuite/affine/store';
import { notify } from '@nota/component';

export function patchFileSizeLimitExtension() {
  class AffineFileSizeLimitService
    extends Extension
    implements IFileSizeLimitService
  {
    // 2GB
    maxFileSize = 2 * 1024 * 1024 * 1024;

    onOverFileSize() {
      notify.warning({
        title: 'File is too large',
        message: 'Nota supports files up to 2 GB in this workspace.',
      });
    }

    static override setup(di: Container) {
      di.override(FileSizeLimitProvider, AffineFileSizeLimitService);
    }
  }

  return AffineFileSizeLimitService;
}
