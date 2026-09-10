export type Repeat = 'once' | 'daily' | 'weekdays' | 'weekends' | 'legal' | 'custom';
export type Alarm = {
  id: string;
  time: string;
  label: string;
  repeat: Repeat;
  days: number[];
  soundPath: string;
  soundName: string;
  enabled: boolean;
  ringSeconds: number;   // 响铃时长（秒）
  snoozeMinutes: number; // 贪睡间隔（分钟），0 = 不贪睡
  snoozeCount: number;   // 再试次数
};
export type PickedAudio = { path: string; name: string } | null;
export type HolidayConfig = { holidays: string[]; workdays: string[] };
export type SoundItem = { path: string; name: string; cover?: string };
// 关闭响铃方式:长按的按键(KeyboardEvent.code)与需要按住的秒数
export type DismissConfig = { dismissKey: string; dismissHoldSeconds: number };
export type SettingsData = {
  closeAction: 'minimize' | 'exit' | null;
  openAtLogin: boolean;
  dismissKey: string;
  dismissHoldSeconds: number;
  version: string;
  author: string;
  github: string;
  runtime: { electron: string; chrome: string; node: string };
  soundsDir: string;
  soundsCount: number;
};

// preload 暴露的 API 全貌(全局声明仅此一处,主界面/设置窗口共用)
declare global {
  interface Window {
    alarmAPI: {
      load: () => Promise<Alarm[]>;
      save: (alarms: Alarm[]) => Promise<void>;
      pickAudio: () => Promise<PickedAudio>;
      loadHolidays: () => Promise<HolidayConfig>;
      openMusicSite: () => Promise<void>;
      openMusicApp: () => Promise<void>;
      onSoundsUpdated: (cb: () => void) => void;
      onDownloadBefore: (cb: (token: string, name: string) => void) => void;
      onDownloadStarted: (cb: (token: string, name: string) => void) => void;
      onDownloadProgress: (cb: (token: string, name: string, received: number, total: number) => void) => void;
      onDownloadDone: (cb: (token: string, final: string) => void) => void;
      onDownloadFailed: (cb: (token: string) => void) => void;
      confirmDownload: (token: string, name: string) => Promise<string | null>;
      cancelDownload: (token: string) => Promise<boolean>;
      listSounds: () => Promise<SoundItem[]>;
      renameSound: (oldName: string, newName: string) => Promise<{ path: string; name: string } | null>;
      deleteSound: (name: string) => Promise<boolean>;
      getSettings: () => Promise<SettingsData>;
      setCloseAction: (a: 'minimize' | 'exit' | null) => Promise<void>;
      setDismiss: (key: string, seconds: number) => Promise<DismissConfig>;
      onSettingsChanged: (cb: (prefs: DismissConfig) => void) => void;
      setAutoLaunch: (on: boolean) => Promise<boolean>;
      openSoundsDir: () => Promise<boolean>;
      openExternal: (url: string) => Promise<void>;
      winMinimize: () => Promise<void>;
      winClose: () => Promise<void>;
      setCompact: (compact: boolean) => Promise<boolean>;
      isCompact: () => Promise<boolean>;
      onCompactChanged: (cb: (compact: boolean) => void) => void;
    };
  }
}
