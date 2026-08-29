/// <reference types="vite/client" />

declare global {
  interface Window {
    alarmAPI: {
      load: () => Promise<import('./types').Alarm[]>;
      save: (alarms: import('./types').Alarm[]) => Promise<void>;
      pickAudio: () => Promise<{ path: string; name: string } | null>;
    };
  }
}
export {};
