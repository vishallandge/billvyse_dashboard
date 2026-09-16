'use client';

import ModuleError from '../components/ModuleError';

export default function AdminError({ reset }) {
  return <ModuleError reset={reset} home="/admin" />;
}
