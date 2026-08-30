import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { zhCN, enUS, frFR, deDE, esES, itIT, ptPT, plPL, nlNL } from '@mui/material/locale';
import App from './App';
import './index.css';
import i18n from './i18n';
import { theme as baseTheme } from './theme';
import { createTheme } from '@mui/material/styles';
import { BrandingProvider, useBranding } from './contexts/BrandingContext';

// Log application version on startup (injected by Vite from package.json)

console.info('[MatchZy] App version:', __APP_VERSION__);

const getMuiLocale = (lang: string) => {
  if (lang.startsWith('zh')) return zhCN;
  if (lang.startsWith('fr')) return frFR;
  if (lang.startsWith('de')) return deDE;
  if (lang.startsWith('es')) return esES;
  if (lang.startsWith('it')) return itIT;
  if (lang.startsWith('pt')) return ptPT;
  if (lang.startsWith('pl')) return plPL;
  if (lang.startsWith('nl')) return nlNL;
  return enUS;
};

const Root: React.FC = () => {
  const { branding } = useBranding();
  const [language, setLanguage] = React.useState(i18n.language);

  React.useEffect(() => {
    const handleLanguageChange = (lng: string) => setLanguage(lng);

    i18n.on('languageChanged', handleLanguageChange);
    return () => {
      i18n.off('languageChanged', handleLanguageChange);
    };
  }, []);

  const muiTheme = React.useMemo(
    () =>
      createTheme(
        baseTheme,
        {
          palette: {
            primary: { main: branding.primaryColor },
            secondary: { main: branding.secondaryColor },
          },
        },
        getMuiLocale(language)
      ),
    [branding.primaryColor, branding.secondaryColor, language]
  );

  return (
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={muiTheme}>
          <CssBaseline />
          <App />
        </ThemeProvider>
      </I18nextProvider>
    </React.StrictMode>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrandingProvider>
    <Root />
  </BrandingProvider>
);
