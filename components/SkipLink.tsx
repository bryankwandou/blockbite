'use client';

import { useT } from '@/lib/i18n';

/**
 * First Tab stop on every page: jumps keyboard users past the header to the page's <main>.
 * Pages render their own <main> without an id, so the target is found at click time.
 */
export default function SkipLink() {
  const t = useT('nav');
  return (
    <a
      href="#main"
      className="bb-skip-link"
      onClick={(e) => {
        const main = document.querySelector('main');
        if (!main) return;
        e.preventDefault();
        if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
        main.focus();
        main.scrollIntoView();
      }}
    >
      {t('skip_to_content')}
    </a>
  );
}
