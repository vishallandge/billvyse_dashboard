'use client';

import ModuleError from '../components/ModuleError';

export default function SellerError({ reset }) {
  return <ModuleError reset={reset} home="/seller" />;
}
