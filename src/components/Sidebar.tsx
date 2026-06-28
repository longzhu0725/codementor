'use client';

import { ViewMode } from '@/types';
import { PixelAvatar } from './PixelAvatar';

export interface SidebarProps {
  activeView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  onOpenSettings: () => void;
  streak: number;
}

interface NavItem {
  id: ViewMode;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'chat',
    label: '对话',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: 'practice',
    label: '练习',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m18 16 4-4-4-4" />
        <path d="m6 8-4 4 4 4" />
        <path d="m14.5 4-5 16" />
      </svg>
    ),
  },
  {
    id: 'dashboard',
    label: '仪表盘',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
];

export function Sidebar({
  activeView,
  onViewChange,
  onOpenSettings,
  streak,
}: SidebarProps) {
  return (
    <aside className="flex h-full w-[68px] flex-col items-center border-r border-border bg-card py-4 lg:w-60 lg:items-stretch lg:px-3">
      {/* Logo / Title */}
      <div className="flex items-center gap-2.5 px-1 lg:px-2">
        <div className="pixel-avatar-box h-9 w-9 shrink-0">
          <PixelAvatar role="logo" size={28} floating />
        </div>
        <div className="hidden lg:block">
          <div className="pixel-font text-[10px] font-bold leading-tight text-foreground">
            CodeMentor
          </div>
          <div className="text-[10px] leading-tight text-muted">
            AI 算法导师
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="mt-7 flex w-full flex-1 flex-col gap-1.5">
        {NAV_ITEMS.map((item) => {
          const active = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all lg:justify-start justify-center ${
                active
                  ? 'bg-accent/15 text-accent'
                  : 'text-muted hover:bg-card-hover hover:text-foreground'
              }`}
              title={item.label}
            >
              <span
                className={`shrink-0 transition-transform group-hover:scale-110 ${
                  active ? 'text-accent' : ''
                }`}
              >
                {item.icon}
              </span>
              <span className="hidden lg:inline">{item.label}</span>
              {active && (
                <span className="hidden lg:ml-auto lg:inline-block h-1.5 w-1.5 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Streak indicator */}
      <div className="mb-2 w-full px-1 lg:px-2">
        <div className="flex items-center justify-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 lg:justify-start">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-warning"
          >
            <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
          </svg>
          <div className="hidden lg:block leading-tight">
            <div className="text-xs font-semibold text-foreground">
              连续 {streak} 天
            </div>
            <div className="text-[10px] text-muted">坚持就是胜利</div>
          </div>
          <span className="lg:hidden text-xs font-bold text-warning">
            {streak}
          </span>
        </div>
      </div>

      {/* Settings */}
      <div className="w-full px-1 lg:px-2">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center justify-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition-all hover:bg-card-hover hover:text-foreground lg:justify-start"
          title="设置"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="hidden lg:inline">设置</span>
        </button>
      </div>
    </aside>
  );
}
