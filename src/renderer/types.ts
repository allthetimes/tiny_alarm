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
