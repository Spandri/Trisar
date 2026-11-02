import { useMemo } from 'react';

export const useJobs = (jobs) =>
  useMemo(() => ({
    jobs: jobs || [],
    hasJobs: Array.isArray(jobs) && jobs.length > 0,
  }), [jobs]);
