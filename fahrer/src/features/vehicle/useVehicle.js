import { useMemo } from 'react';

export const useVehicle = ({ currentVehicle, vehicleDamages }) =>
  useMemo(() => ({
    currentVehicle: currentVehicle || null,
    vehicleDamages: vehicleDamages || [],
  }), [currentVehicle, vehicleDamages]);
