import React, { createContext, useContext } from 'react';
import { useWinmixEngine, type WinmixEngine } from '../hooks/useWinmixEngine';

const WinmixContext = createContext<WinmixEngine | null>(null);

export function WinmixProvider({ children }: {children: React.ReactNode;}) {
  const engine = useWinmixEngine();
  return <WinmixContext.Provider value={engine}>{children}</WinmixContext.Provider>;
}

export function useWinmix(): WinmixEngine {
  const ctx = useContext(WinmixContext);
  if (!ctx) throw new Error('useWinmix must be used inside a WinmixProvider');
  return ctx;
}