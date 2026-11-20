import { kolonnenNameKurz } from '../../shared/utils/kolonnenName';
import { useMemo } from 'react';

export const useChatThreads = ({ jobs = [], ownDriverId }) =>
  useMemo(() => {
    const map = new Map();
    jobs.forEach((job) => {
      if (job?.isKolonne && job?.convoyId) {
        map.set(`group:${job.convoyId}`, { id: job.convoyId, name: kolonnenNameKurz(job.kolonneName) || 'Kolonne', type: 'group' });
      }
      (job?.kolonneDrivers || []).forEach((driver) => {
        if (!driver?.id || driver.id === ownDriverId) return;
        map.set(`individual:${driver.id}`, { id: driver.id, name: driver.name || 'Fahrer', type: 'individual' });
      });
    });
    return Array.from(map.values());
  }, [jobs, ownDriverId]);
