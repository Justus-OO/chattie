import { useContext } from 'react';
import { DialogContext } from './DialogContext';

export function useAppDialogs() {
  const dialogs = useContext(DialogContext);
  if (!dialogs) throw new Error('useAppDialogs must be used within DialogProvider.');
  return dialogs;
}
