'use client';

import type { PublicLandingPageContentDto } from '@linkiq/types';
import { ChevronDown } from 'lucide-react';
import * as React from 'react';

const DEFAULT_SECTION = { eyebrow: 'Questions', headline: 'Frequently asked questions' };

const DEFAULT_FAQS: PublicLandingPageContentDto['faqs'] = [
  {
    question: 'What is LinkIQ?',
    answer:
      'LinkIQ is a link management platform for modern teams — shorten and share links, brand them with your own domain, track clicks in real time, and automate link creation through an API.',
  },
  {
    question: 'Can I use my own domain?',
    answer:
      'Yes. Connect a custom domain to your workspace, verify ownership with a DNS record, and every link you create can use your branded domain instead of a generic shortener host.',
  },
  {
    question: 'Can I track clicks?',
    answer:
      'Yes. Every link reports real-time analytics — total clicks, devices, countries, and referrers — broken down per link and per campaign so you can see exactly what is driving traffic.',
  },
  {
    question: 'Does LinkIQ have an API?',
    answer:
      'Yes. LinkIQ ships a REST API secured with scoped API keys, so you can create and manage links programmatically and subscribe to webhook events for real-time notifications.',
  },
  {
    question: 'Can teams collaborate?',
    answer:
      'Yes. Every workspace supports role-based access for your team — owners, admins, members, and viewers — so you can collaborate on links and campaigns with the right level of access for each person.',
  },
  {
    question: 'How does billing work?',
    answer:
      'LinkIQ offers a free plan plus paid plans that scale with usage — links, clicks, domains, and team seats. Paid plans include a trial period, and you can change plans at any time from your workspace billing settings.',
  },
];

function FaqItem({
  question,
  answer,
  isOpen,
  onToggle,
  id,
}: {
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
  id: string;
}) {
  const panelId = `${id}-panel`;
  const buttonId = `${id}-button`;

  return (
    <div className="border-b border-border py-2">
      <h3>
        <button
          id={buttonId}
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-4 py-4 text-left text-base font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {question}
          <ChevronDown
            aria-hidden="true"
            className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={!isOpen}
        className="pb-4 pr-8 text-sm leading-relaxed text-muted-foreground"
      >
        {answer}
      </div>
    </div>
  );
}

/** Hand-rolled accordion — no accordion dependency exists in
 * @linkiq/ui, and one FAQ list doesn't justify adding one. Single item
 * open at a time; each trigger is a real <button> so it's keyboard
 * operable (Enter/Space, natural Tab order) without any custom key
 * handling. */
interface FaqSectionProps {
  content?: PublicLandingPageContentDto['sections'][number];
  faqs?: PublicLandingPageContentDto['faqs'];
}

export function FaqSection({ content, faqs }: FaqSectionProps) {
  const [openIndex, setOpenIndex] = React.useState<number | null>(0);
  const eyebrow = content?.eyebrow ?? DEFAULT_SECTION.eyebrow;
  const headline = content?.headline ?? DEFAULT_SECTION.headline;
  const items = faqs && faqs.length > 0 ? faqs : DEFAULT_FAQS;

  if (items.length === 0) return null;

  return (
    <section
      id="faq"
      className="border-t border-white/10 bg-muted py-24 sm:py-32"
    >
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          {eyebrow && (
            <p className="font-mono text-xs font-semibold uppercase tracking-wide text-primary">
              {eyebrow}
            </p>
          )}
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {headline}
          </h2>
        </div>
        <div className="mx-auto mt-12 max-w-2xl">
          {items.map((faq, index) => (
            <FaqItem
              key={faq.question}
              id={`faq-${index}`}
              question={faq.question}
              answer={faq.answer}
              isOpen={openIndex === index}
              onToggle={() =>
                setOpenIndex((current) => (current === index ? null : index))
              }
            />
          ))}
        </div>
      </div>
    </section>
  );
}
