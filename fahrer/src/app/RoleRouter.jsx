import React from 'react';
import FahrerApp from '../features/fahrer/FahrerApp';

const RoleRouter = ({ session }) => {
  if (!session) return null;
  return <FahrerApp session={session} />;
};

export default RoleRouter;
