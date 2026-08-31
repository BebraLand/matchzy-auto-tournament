import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { BrandingResponse, BrandingSettings, SettingsResponse } from '../types/api.types';

export const DEFAULT_BRANDING: BrandingSettings = {
  displayName: 'Matchzy Auto Tournament',
  logoUrl: '/icon.svg',
  primaryColor: '#D0BCFF',
  secondaryColor: '#CCC2DC',
  showGitHubLink: true,
  showDocumentationLink: true,
  showVersion: true,
};

const BrandingContext = createContext<{
  branding: BrandingSettings;
  refreshBranding: () => Promise<void>;
}>({ branding: DEFAULT_BRANDING, refreshBranding: async () => undefined });

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState(DEFAULT_BRANDING);

  const applyBranding = useCallback((next: Partial<BrandingSettings> | undefined) => {
    if (!next) return;
    setBranding((current) => ({ ...current, ...next }));
  }, []);

  const refreshBranding = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/branding');
      if (!response.ok) return;
      const data = (await response.json()) as BrandingResponse;
      applyBranding(data.branding);
    } catch {
      // Defaults keep the app usable while the API is unavailable.
    }
  }, [applyBranding]);

  useEffect(() => {
    // Initial branding is loaded from the public settings endpoint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshBranding();

    const handleSettingsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<SettingsResponse['settings']>;
      applyBranding(customEvent.detail?.branding);
    };
    window.addEventListener('matchzy:settingsUpdated', handleSettingsUpdated);
    const handleBrandingUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<BrandingSettings>;
      applyBranding(customEvent.detail);
    };
    window.addEventListener('matchzy:brandingUpdated', handleBrandingUpdated);
    return () => {
      window.removeEventListener('matchzy:settingsUpdated', handleSettingsUpdated);
      window.removeEventListener('matchzy:brandingUpdated', handleBrandingUpdated);
    };
  }, [applyBranding, refreshBranding]);

  useEffect(() => {
    document.title = branding.displayName;
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon) favicon.setAttribute('href', branding.logoUrl);
    document.documentElement.style.setProperty('--brand-primary', branding.primaryColor);
    document.documentElement.style.setProperty('--brand-secondary', branding.secondaryColor);
  }, [branding]);

  return (
    <BrandingContext.Provider value={{ branding, refreshBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
