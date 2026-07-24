import type { CapacitorConfig } from '@capacitor/cli';

// Optional live-reload onto a device: set CAP_SERVER_URL to your machine's LAN
// address (e.g. http://192.168.1.20:5274) before `cap:sync`.
const devServerUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.simonhill.combatclean',
  appName: 'Combat Clean',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    ...(devServerUrl ? { url: devServerUrl, cleartext: true } : {}),
  },
};

export default config;
