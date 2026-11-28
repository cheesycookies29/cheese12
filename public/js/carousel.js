// A sideways row of cards, as on the ATLAS home: the cards scroll and snap into place (swipe on a
// phone, the arrows or dots elsewhere, or the arrow keys once the row has focus). The arrows and
// dots only show when some cards are out of view. Used by "Your modules" on the CORE home and by its
// Forms & downloads when there are more than 4 (0.75.1).
//
// carousel({ wrap, track, arrows, prev, next, dots, label }): wrap gets more-left/more-right (the
// soft fade), label names the dots ("Modules, page 2 of 3"). Returns refresh(), to call after the
// cards are redrawn.
export function carousel({ wrap, track, arrows, prev, next, dots, label = 'Page' }) {
  const smooth = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  const cardStep = () => (track.children[1] ? track.children[1].offsetLeft - track.children[0].offsetLeft : track.clientWidth);
  const perPage = () => Math.max(1, Math.round(track.clientWidth / cardStep()));
  const pages = () => Math.max(1, Math.ceil(track.children.length / perPage() - 0.01));
  const atEnd = () => track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
  const pageNow = () => (atEnd() ? pages() - 1 : Math.min(pages() - 1, Math.round(track.scrollLeft / (cardStep() * perPage()))));
  const goPage = (n) => track.scrollTo({ left: Math.max(0, n) * cardStep() * perPage(), behavior: smooth() });
  let drawn = -1;
  const update = () => {
    if (!track.isConnected) return;
    const overflow = track.scrollWidth > track.clientWidth + 2;
    if (arrows) arrows.hidden = !overflow;
    dots.hidden = !overflow;
    wrap.classList.toggle('more-left', overflow && track.scrollLeft > 4);
    wrap.classList.toggle('more-right', overflow && track.scrollLeft + track.clientWidth < track.scrollWidth - 4);
    prev.disabled = track.scrollLeft <= 4;
    next.disabled = atEnd();
    if (!overflow) return;
    if (drawn !== pages()) {
      drawn = pages();
      dots.innerHTML = Array.from({ length: drawn }, (_, i) => `<button type="button" data-page="${i}" aria-label="${label}, page ${i + 1} of ${drawn}"></button>`).join('');
    }
    [...dots.children].forEach((d, i) => d.setAttribute('aria-current', i === pageNow() ? 'true' : 'false'));
  };
  prev.addEventListener('click', () => goPage(pageNow() - 1));
  next.addEventListener('click', () => goPage(pageNow() + 1));
  dots.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) goPage(Number(b.dataset.page));
  });
  track.addEventListener('keydown', (e) => {
    if (e.target !== track || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    track.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * cardStep(), behavior: smooth() });
  });
  // A card reached with Tab is brought fully into view.
  track.addEventListener('focusin', (e) => {
    const card = [...track.children].find((c) => c.contains(e.target));
    if (card) card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth() });
  });
  let raf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  }, { passive: true });
  const ro = new ResizeObserver(() => (track.isConnected ? update() : ro.disconnect()));
  ro.observe(track);
  update();
  return () => {
    drawn = -1;
    update();
  };
}
