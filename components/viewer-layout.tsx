'use client';

import { useState, type ReactNode } from 'react';
import { FileText, MessageSquare, Sparkles } from 'lucide-react';

type Tab = 'pdf' | 'comments' | 'chat';

/**
 * Desktop shows the PDF beside a tabbed panel. Below `lg` the panes stack into a
 * single view chosen from a bottom bar, because a side-by-side PDF and chat are
 * both unusable at phone widths.
 */
export function ViewerLayout({
  pdf, chat, comments,
}: {
  pdf: ReactNode;
  chat: ReactNode;
  comments: ReactNode;
}) {
  const [mobileTab, setMobileTab] = useState<Tab>('pdf');
  const [desktopTab, setDesktopTab] = useState<Exclude<Tab, 'pdf'>>('chat');

  return (
    <>
      <div className="hidden min-h-0 flex-1 lg:flex">
        <div className="min-h-0 w-3/5">{pdf}</div>
        <div className="flex min-h-0 w-2/5 flex-col border-l bg-surface">
          <div className="flex shrink-0 border-b" role="tablist">
            {(['chat', 'comments'] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={desktopTab === tab}
                onClick={() => setDesktopTab(tab)}
                className={`flex-1 px-4 py-2.5 text-sm transition ${
                  desktopTab === tab
                    ? 'border-b-2 border-clay font-medium'
                    : 'text-ink/80 hover:text-ink'
                }`}
              >
                {tab === 'chat' ? 'AI chat' : 'Comments'}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">{desktopTab === 'chat' ? chat : comments}</div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div className="min-h-0 flex-1">
          {mobileTab === 'pdf' ? pdf : mobileTab === 'chat' ? chat : comments}
        </div>
        <nav className="flex shrink-0 border-t bg-surface" aria-label="View">
          {(
            [
              ['pdf', 'PDF', FileText],
              ['comments', 'Comments', MessageSquare],
              ['chat', 'AI chat', Sparkles],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setMobileTab(key)}
              aria-current={mobileTab === key}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
                mobileTab === key ? 'font-medium text-ink' : 'text-ink/80'
              }`}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
