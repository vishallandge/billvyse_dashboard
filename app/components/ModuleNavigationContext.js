'use client';

import { createContext } from 'react';

// Loading boundaries report their lifetime to the shell's single loading indicator.
export const ModuleNavigationContext = createContext(null);
