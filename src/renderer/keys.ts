// 按键展示名:把 KeyboardEvent.code 转成用户可读的中文标签。
// 主窗口(响铃遮罩文案)与设置窗口(按键捕获按钮)共用,保证两处显示一致。
const NAMED_KEYS: Record<string, string> = {
  Space: '空格',
  Enter: '回车',
  NumpadEnter: '小键盘回车',
  Tab: 'Tab',
  CapsLock: '大写锁定',
  Backspace: '退格',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: '↑ 方向键',
  ArrowDown: '↓ 方向键',
  ArrowLeft: '← 方向键',
  ArrowRight: '→ 方向键',
  ShiftLeft: '左 Shift',
  ShiftRight: '右 Shift',
  ControlLeft: '左 Ctrl',
  ControlRight: '右 Ctrl',
  AltLeft: '左 Alt',
  AltRight: '右 Alt',
  MetaLeft: '左 Win',
  MetaRight: '右 Win',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`'
};

export function keyLabel(code: string): string {
  if (!code) return '空格';
  if (NAMED_KEYS[code]) return NAMED_KEYS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `小键盘 ${code.slice(6)}`;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return code.replace(/^(Key|Digit)/, '');
}
