import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { discoveryService } from '../api/discovery.service';

export function usePremiumStatus() {
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    let active = true;

    discoveryService.getPremiumStatus()
      .then(status => {
        if (active) setIsPremium(status);
      })
      .catch(error => {
        if (active) toast.error(error.message || 'Failed to load subscription status');
      });

    return () => {
      active = false;
    };
  }, []);

  return isPremium;
}
