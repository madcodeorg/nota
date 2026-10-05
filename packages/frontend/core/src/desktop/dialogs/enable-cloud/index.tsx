import type {
  DialogComponentProps,
  GLOBAL_DIALOG_SCHEMA,
} from '@nota/core/modules/dialogs';

// Enable-cloud dialog disabled — EE backend removed
export const EnableCloudDialog = ({
  close,
}: DialogComponentProps<GLOBAL_DIALOG_SCHEMA['enable-cloud']>) => {
  // Immediately close since cloud sync is unavailable
  close();
  return null;
};
