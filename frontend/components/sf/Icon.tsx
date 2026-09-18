/**
 * The app's icon set, drawn by lucide.
 *
 * These rows used to carry single glyph characters ('⌂', '▤', '‹›'), then a
 * hand-drawn table of SVG paths. Both said the same thing badly: the set only
 * reads as one voice if every mark comes off one grid at one stroke weight.
 * lucide already is that grid, so the table is gone and this module is now the
 * registry that maps our names onto it — one place to see what mark a concept
 * gets, and the only place a lucide import needs to appear.
 */
import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle, AlignCenter, AlignJustify, AlignLeft, ArrowDown,
  ArrowDownWideNarrow, ArrowLeft, ArrowRight, ArrowUp, ArrowUpNarrowWide,
  Asterisk, Bell, Ban, Building2, Calendar, ChartColumn, Check, CheckSquare,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleDot, Clock, Code2,
  Copy, CopyPlus, CreditCard, DollarSign, Download, ExternalLink, Eye, File,
  FileText, Filter, Grid3x3, Headphones, Home, Image, Inbox, Key, Link2,
  ListFilter, LogIn, LogOut, Mail, Maximize, Minus, Move, MoveHorizontal,
  PanelLeft, Pause, PenLine, Pencil, Play, Plus, Printer, RefreshCw, Redo2,
  Rocket, Save, Search, Send, Settings, Share2, Shield, SlidersHorizontal,
  Monitor, Smartphone,
  Stamp, Star, Trash2, Undo2, Upload, UserPlus, Users, Wallet, X, Zap,
} from 'lucide-react';

export const ICONS = {
  home: Home, documents: FileText, contacts: Users, reports: ChartColumn,
  developer: Code2, support: Headphones, account: Settings, tenants: Building2,
  revenue: DollarSign,
  chevronLeft: ChevronLeft, chevronRight: ChevronRight, caretDown: ChevronDown,
  caretUp: ChevronUp, arrowUp: ArrowUp, arrowDown: ArrowDown,
  arrowLeft: ArrowLeft, arrowRight: ArrowRight,
  sortAsc: ArrowUpNarrowWide, sortDesc: ArrowDownWideNarrow,
  signOut: LogOut, signIn: LogIn, close: X, bell: Bell, check: Check,
  minus: Minus, alert: AlertCircle, asterisk: Asterisk, trash: Trash2,
  pencil: Pencil, star: Star, checkbox: CheckSquare, stamp: Stamp, move: Move,
  fit: Maximize, distribute: AlignJustify, radio: CircleDot, upload: Upload,
  undo: Undo2, redo: Redo2, plus: Plus, fitWidth: MoveHorizontal, grid: Grid3x3,
  alignLeft: AlignLeft, alignCenter: AlignCenter, duplicate: Copy,
  duplicateAll: CopyPlus, preview: PanelLeft, externalLink: ExternalLink,
  /* Added with the button pass: every action in the app names its mark here. */
  save: Save, send: Send, download: Download, print: Printer, copy: Copy,
  search: Search, filter: Filter, sort: ListFilter, settings: SlidersHorizontal,
  refresh: RefreshCw, link: Link2, share: Share2, mail: Mail, key: Key,
  shield: Shield, wallet: Wallet, card: CreditCard, clock: Clock,
  calendar: Calendar, inbox: Inbox, file: File, image: Image, eye: Eye,
  sign: PenLine, addUser: UserPlus, play: Play, pause: Pause, cancel: Ban,
  publish: Rocket, test: Zap, desktop: Monitor, mobile: Smartphone,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/* Several menus and toolbars are built from a list of action *labels* — row
   menus, bulk bars, a row's primary call to action. They need a mark too, and
   the label is all the call site has, so the lookup lives here beside the
   registry rather than being re-guessed screen by screen. */
const BY_ACTION: [RegExp, IconName][] = [
  [/download|export/i, 'download'], [/print/i, 'print'], [/copy link|invite link/i, 'link'],
  [/copy|duplicate/i, 'copy'], [/share/i, 'share'], [/email|mail|resend/i, 'mail'],
  [/delete|remove/i, 'trash'], [/archive/i, 'inbox'], [/move|merge/i, 'move'],
  [/rename|edit|prepare|add fields/i, 'pencil'], [/template/i, 'documents'],
  [/preview|open|view/i, 'eye'], [/notariz|sign/i, 'sign'], [/send|invite/i, 'send'],
  [/save/i, 'save'], [/cancel|close|decline/i, 'close'], [/new|add|create/i, 'plus'],
  [/refresh|retry|reset|again/i, 'refresh'], [/search|filter/i, 'filter'],
];

/** The mark for a free-text action label, falling back to a neutral chevron so
 *  an unmapped label still reads as a button rather than as bare text. */
export function markFor(label: string): IconName {
  for (const [pattern, name] of BY_ACTION) if (pattern.test(label)) return name;
  return 'arrowRight';
}

export type IconProps = {
  name: IconName;
  /** Rendered size in px; the grid scales with it. */
  size?: number;
  /** Fill the shape with `currentColor` — used for the on state of a mark that
   *  has both (a favourite star, say), so outline and solid stay one drawing. */
  solid?: boolean;
  style?: CSSProperties;
};

/** Decorative by contract: every place that draws one already carries the
 *  label in text or in `aria-label`, so the SVG stays out of the a11y tree. */
export default function Icon({ name, size = 15, solid, style }: IconProps) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      size={size}
      strokeWidth={1.7}
      fill={solid ? 'currentColor' : 'none'}
      aria-hidden="true"
      focusable="false"
      style={{ display:'block', flex:'0 0 auto', ...style }}
    />
  );
}
