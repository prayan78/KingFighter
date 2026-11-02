import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.kingfighter.arena',
  appName: 'KingFighter',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { backgroundColor: '#090d14', allowMixedContent: false },
}

export default config
