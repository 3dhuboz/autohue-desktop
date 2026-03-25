/** Shared SVG icon library — replaces all emoji with crisp vector icons */

interface IconProps {
  className?: string;
  size?: number;
}

const s = (size?: number) => ({ width: size || 16, height: size || 16 });

// ─── Brand ───

export function LogoMark({ className, size = 32 }: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" {...s(size)} className={className}>
      <defs>
        <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#991b1b" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill="url(#logo-grad)" />
      <path d="M12 28L20 10L28 28H24L20 18L16 28H12Z" fill="white" fillOpacity="0.95" />
      <rect x="14" y="25" width="12" height="2.5" rx="1.25" fill="white" fillOpacity="0.6" />
    </svg>
  );
}

// ─── Navigation ───

export function SortIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" {...s(size)} className={className}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}

export function HistoryIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" {...s(size)} className={className}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8L10.5 10" />
    </svg>
  );
}

export function SettingsIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" {...s(size)} className={className}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5V3.5M8 12.5V14.5M1.5 8H3.5M12.5 8H14.5M3.05 3.05L4.46 4.46M11.54 11.54L12.95 12.95M3.05 12.95L4.46 11.54M11.54 4.46L12.95 3.05" />
    </svg>
  );
}

// ─── Actions ───

export function FolderIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <path d="M2 4.5C2 3.67 2.67 3 3.5 3H6L7.5 5H12.5C13.33 5 14 5.67 14 6.5V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V4.5Z" />
    </svg>
  );
}

export function ImageIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <circle cx="5.5" cy="5.5" r="1.5" fill="currentColor" fillOpacity="0.3" />
      <path d="M2 11L5 8L7 10L10 6L14 11" />
    </svg>
  );
}

export function UploadIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <path d="M8 10V2M8 2L5 5M8 2L11 5" />
      <path d="M2 10V12.5C2 13.33 2.67 14 3.5 14H12.5C13.33 14 14 13.33 14 12.5V10" />
    </svg>
  );
}

export function DownloadIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <path d="M8 2V10M8 10L5 7M8 10L11 7" />
      <path d="M2 10V12.5C2 13.33 2.67 14 3.5 14H12.5C13.33 14 14 13.33 14 12.5V10" />
    </svg>
  );
}

export function TrashIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <path d="M3 4H13M5.5 4V3C5.5 2.45 5.95 2 6.5 2H9.5C10.05 2 10.5 2.45 10.5 3V4M6 7V11M10 7V11" />
      <path d="M4 4L4.5 13C4.5 13.55 4.95 14 5.5 14H10.5C11.05 14 11.5 13.55 11.5 13L12 4" />
    </svg>
  );
}

export function CloseIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...s(size)} className={className}>
      <path d="M4 4L12 12M12 4L4 12" />
    </svg>
  );
}

export function RefreshIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <path d="M2.5 8C2.5 4.96 4.96 2.5 8 2.5C10.21 2.5 12.1 3.84 12.92 5.75" />
      <path d="M13.5 8C13.5 11.04 11.04 13.5 8 13.5C5.79 13.5 3.9 12.16 3.08 10.25" />
      <path d="M13 3V6H10" />
      <path d="M3 13V10H6" />
    </svg>
  );
}

export function CheckIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <path d="M3 8.5L6.5 12L13 4" />
    </svg>
  );
}

export function AlertIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" {...s(size)} className={className}>
      <path d="M8 1.5L14.5 13H1.5L8 1.5Z" />
      <path d="M8 6V9" />
      <circle cx="8" cy="11" r="0.5" fill="currentColor" />
    </svg>
  );
}

export function InfoIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" {...s(size)} className={className}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7V11" />
      <circle cx="8" cy="5" r="0.5" fill="currentColor" />
    </svg>
  );
}

export function KeyIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <circle cx="5.5" cy="10.5" r="3" />
      <path d="M8 8L13 3M11.5 3H13.5V5" />
    </svg>
  );
}

export function CopyIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5C11 2.67 10.33 2 9.5 2H3.5C2.67 2 2 2.67 2 3.5V9.5C2 10.33 2.67 11 3.5 11H5" />
    </svg>
  );
}

export function ExternalIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <path d="M12 8.5V12.5C12 13.33 11.33 14 10.5 14H3.5C2.67 14 2 13.33 2 12.5V5.5C2 4.67 2.67 4 3.5 4H7.5" />
      <path d="M10 2H14V6" />
      <path d="M14 2L7 9" />
    </svg>
  );
}

// ─── Processing Pipeline ───

export function CrosshairIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" {...s(size)} className={className}>
      <circle cx="8" cy="8" r="5" />
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1V3M8 13V15M1 8H3M13 8H15" />
    </svg>
  );
}

export function PaletteIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <path d="M8 2C4.69 2 2 4.69 2 8C2 11.31 4.69 14 8 14C8.55 14 9 13.55 9 13V12.5C9 12.22 9.11 11.97 9.29 11.79C9.47 11.61 9.72 11.5 10 11.5H11C12.66 11.5 14 10.16 14 8.5C14 4.91 11.31 2 8 2Z" />
      <circle cx="5" cy="7" r="1" fill="currentColor" fillOpacity="0.4" />
      <circle cx="7" cy="4.5" r="1" fill="currentColor" fillOpacity="0.4" />
      <circle cx="10" cy="5" r="1" fill="currentColor" fillOpacity="0.4" />
    </svg>
  );
}

export function BrainIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <path d="M8 14V8" />
      <path d="M5.5 3C4.12 3 3 4.12 3 5.5C3 5.5 2 5.5 2 7C2 8.5 3.5 9 3.5 9C3.5 10.5 4.5 11 5.5 11C6.5 11 7 10 8 10" />
      <path d="M10.5 3C11.88 3 13 4.12 13 5.5C13 5.5 14 5.5 14 7C14 8.5 12.5 9 12.5 9C12.5 10.5 11.5 11 10.5 11C9.5 11 9 10 8 10" />
    </svg>
  );
}

export function FlagIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <path d="M3 2V14" />
      <path d="M3 2H12L10 5.5L12 9H3" fill="currentColor" fillOpacity="0.15" />
      <path d="M3 2H12L10 5.5L12 9H3" />
    </svg>
  );
}

export function ChartIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <path d="M2 14H14" />
      <rect x="3" y="8" width="2" height="6" rx="0.5" fill="currentColor" fillOpacity="0.2" />
      <rect x="7" y="4" width="2" height="10" rx="0.5" fill="currentColor" fillOpacity="0.2" />
      <rect x="11" y="6" width="2" height="8" rx="0.5" fill="currentColor" fillOpacity="0.2" />
    </svg>
  );
}

export function TerminalIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M4.5 6L7 8.5L4.5 11" />
      <path d="M8.5 11H11.5" />
    </svg>
  );
}

export function SpinnerIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...s(size)} className={`animate-spin ${className || ''}`}>
      <path d="M8 2C4.69 2 2 4.69 2 8" />
    </svg>
  );
}

export function CarIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <path d="M5 17H3.5C2.67 17 2 16.33 2 15.5V12L4 7H17L20 12V15.5C20 16.33 19.33 17 18.5 17H17" />
      <circle cx="7.5" cy="17" r="2" />
      <circle cx="14.5" cy="17" r="2" />
      <path d="M4 12H20" />
      <path d="M7 7L8 4H14L15 7" />
    </svg>
  );
}

// ─── Tier Icons ───

export function StarIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" fillOpacity="0.8" {...s(size)} className={className}>
      <path d="M8 1.5L9.8 5.9L14.5 6.4L11 9.6L12 14.2L8 11.8L4 14.2L5 9.6L1.5 6.4L6.2 5.9L8 1.5Z" />
    </svg>
  );
}

export function CrownIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" fillOpacity="0.8" {...s(size)} className={className}>
      <path d="M2 12H14V13.5H2V12ZM2 11L4.5 5L8 8L11.5 5L14 11H2Z" />
    </svg>
  );
}

export function RocketIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...s(size)} className={className}>
      <path d="M8 1C8 1 3 6 3 11L5.5 13L8 10.5L10.5 13L13 11C13 6 8 1 8 1Z" />
      <circle cx="8" cy="7" r="1.5" />
    </svg>
  );
}

export function InfinityIcon({ className, size }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" {...s(size)} className={className}>
      <path d="M4.5 8C4.5 6.34 3.66 5 2.5 5C1.34 5 0.5 6.34 0.5 8C0.5 9.66 1.34 11 2.5 11C3.66 11 4.5 9.66 4.5 8ZM4.5 8C4.5 6.34 5.84 5 7 5C8.16 5 9 6.34 9 8C9 9.66 8.16 11 7 11C5.84 11 4.5 9.66 4.5 8Z" transform="translate(2, 0)" />
    </svg>
  );
}

// ─── Status ───

export function StatusDot({ color = 'green', pulse = true, className }: { color?: 'green' | 'yellow' | 'red'; pulse?: boolean; className?: string }) {
  const colors = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
  };
  const glows = {
    green: 'shadow-[0_0_8px_rgba(34,197,94,0.6)]',
    yellow: 'shadow-[0_0_8px_rgba(234,179,8,0.6)]',
    red: 'shadow-[0_0_8px_rgba(239,68,68,0.6)]',
  };
  return (
    <span className={`relative flex h-2 w-2 ${className || ''}`}>
      {pulse && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${colors[color]} opacity-75`} />}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${colors[color]} ${glows[color]}`} />
    </span>
  );
}
