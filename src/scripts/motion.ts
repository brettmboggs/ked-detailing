/**
 * Site-wide motion: Lenis-driven scroll, GSAP entrances, marquees, 3D card
 * tilt, and the FAQ accordion.
 *
 * Everything here is opt-out: if the user prefers reduced motion we make all
 * animated elements visible in their final state and wire up only the
 * behaviour that carries meaning (accordion, header state).
 */

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------------------------------------------------------- accordion */

function initAccordion() {
  document.querySelectorAll<HTMLButtonElement>('[data-faq-toggle]').forEach((btn) => {
    const item = btn.closest('[data-faq]') as HTMLElement | null;
    const panel = item?.querySelector<HTMLElement>('[data-faq-panel]');
    const icon = btn.querySelector<HTMLElement>('[data-faq-icon]');
    if (!item || !panel) return;

    btn.addEventListener('click', () => {
      const open = item.dataset.open === 'true';

      // Single-open accordion: close whatever else is expanded.
      document.querySelectorAll<HTMLElement>('[data-faq][data-open="true"]').forEach((other) => {
        if (other === item) return;
        const otherPanel = other.querySelector<HTMLElement>('[data-faq-panel]');
        const otherBtn = other.querySelector<HTMLButtonElement>('[data-faq-toggle]');
        const otherIcon = other.querySelector<HTMLElement>('[data-faq-icon]');
        other.dataset.open = 'false';
        otherBtn?.setAttribute('aria-expanded', 'false');
        if (otherIcon) gsap.to(otherIcon, { rotate: 0, duration: 0.35, ease: 'expo.out' });
        if (otherPanel) {
          gsap.to(otherPanel, { height: 0, opacity: 0, duration: 0.4, ease: 'expo.out' });
        }
      });

      item.dataset.open = open ? 'false' : 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');

      if (icon) gsap.to(icon, { rotate: open ? 0 : 135, duration: 0.4, ease: 'expo.out' });
      gsap.to(panel, {
        height: open ? 0 : 'auto',
        opacity: open ? 0 : 1,
        duration: 0.5,
        ease: 'expo.out',
        onComplete: () => ScrollTrigger.refresh(),
      });
    });
  });
}

/* ------------------------------------------------------------------- header */

function initHeader(getScroll: () => number) {
  const header = document.querySelector<HTMLElement>('[data-header]');
  if (!header) return;

  let last = 0;
  const onScroll = () => {
    const y = getScroll();
    header.dataset.stuck = y > 40 ? 'true' : 'false';
    // Hide going down, reveal going up — but never hide near the very top.
    header.dataset.hidden = y > 400 && y > last ? 'true' : 'false';
    last = y;
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  return onScroll;
}

/* ------------------------------------------------------------- mobile menu */

function initMenu() {
  const btn = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const panel = document.querySelector<HTMLElement>('[data-menu]');
  if (!btn || !panel) return;

  const setOpen = (open: boolean) => {
    panel.dataset.open = String(open);
    btn.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  };

  btn.addEventListener('click', () => setOpen(panel.dataset.open !== 'true'));
  panel.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.dataset.open === 'true') setOpen(false);
  });
}

/* --------------------------------------------------------------- card tilt */

function initTilt() {
  if (REDUCED) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  document.querySelectorAll<HTMLElement>('[data-tilt]').forEach((card) => {
    const inner = card.querySelector<HTMLElement>('[data-tilt-inner]') ?? card;
    const glare = card.querySelector<HTMLElement>('[data-tilt-glare]');
    const max = Number(card.dataset.tilt) || 7;

    const setX = gsap.quickTo(inner, 'rotationY', { duration: 0.6, ease: 'power3' });
    const setY = gsap.quickTo(inner, 'rotationX', { duration: 0.6, ease: 'power3' });
    const setZ = gsap.quickTo(inner, 'z', { duration: 0.6, ease: 'power3' });

    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      setX((px - 0.5) * max * 2);
      setY(-(py - 0.5) * max * 2);
      setZ(28);
      if (glare) {
        glare.style.background = `radial-gradient(420px circle at ${px * 100}% ${py * 100}%, rgba(245,199,106,0.16), transparent 60%)`;
        glare.style.opacity = '1';
      }
    });

    card.addEventListener('pointerleave', () => {
      setX(0);
      setY(0);
      setZ(0);
      if (glare) glare.style.opacity = '0';
    });
  });
}

/* ---------------------------------------------------------------- marquees */

function initMarquee() {
  document.querySelectorAll<HTMLElement>('[data-marquee]').forEach((el) => {
    const track = el.querySelector<HTMLElement>('[data-marquee-track]');
    if (!track) return;

    // Duplicate the row so the loop has something to scroll into.
    const original = track.innerHTML;
    track.innerHTML = original + original;

    if (REDUCED) return;

    const goingLeft = el.dataset.marqueeDir !== 'right';

    // Duration is derived from how wide the track actually is, so the ticker
    // moves at a constant speed no matter how many items are in it. A fixed
    // duration meant adding entries silently sped the whole thing up.
    const pxPerSecond = Number(el.dataset.marqueeSpeed) || 55;
    const travel = track.scrollWidth / 2;
    const duration = travel > 0 ? travel / pxPerSecond : 40;

    // Both directions run the same tween forwards. Rightward simply starts
    // half a lap in and animates back to zero, which keeps timeScale positive
    // throughout — a negative timeScale drove the tween back into progress 0,
    // where it stuck after a single segment.
    gsap.set(track, { xPercent: goingLeft ? 0 : -50 });
    const loop = gsap.to(track, {
      xPercent: goingLeft ? -50 : 0,
      duration,
      ease: 'none',
      repeat: -1,
    });

    // Scroll velocity speeds it up, so the page feels physically linked. It
    // only ever scales the magnitude; it must never flip the sign.
    ScrollTrigger.create({
      trigger: el,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: (self) => {
        const boost = 1 + Math.min(Math.abs(self.getVelocity()) / 1400, 3.2);
        gsap.to(loop, { timeScale: boost, duration: 0.3, overwrite: true });
      },
      onLeave: () => gsap.to(loop, { timeScale: 1, duration: 0.6 }),
      onLeaveBack: () => gsap.to(loop, { timeScale: 1, duration: 0.6 }),
    });
  });
}

/* -------------------------------------------------------------- entrances */

function initReveals() {
  // Hero headline clips up line by line.
  const heroLines = gsap.utils.toArray<HTMLElement>('[data-hero-line] > span');
  if (heroLines.length) {
    gsap.to(heroLines, {
      y: '0%',
      duration: 1.25,
      ease: 'expo.out',
      stagger: 0.09,
      delay: 0.25,
    });
  }

  gsap.to('[data-hero-fade]', {
    opacity: 1,
    y: 0,
    duration: 1,
    ease: 'expo.out',
    stagger: 0.1,
    delay: 0.75,
  });

  // Generic rise-on-enter.
  gsap.utils.toArray<HTMLElement>('.rise').forEach((el) => {
    gsap.to(el, {
      opacity: 1,
      y: 0,
      duration: 1,
      ease: 'expo.out',
      delay: Number(el.dataset.delay) || 0,
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });

  // Staggered groups.
  gsap.utils.toArray<HTMLElement>('[data-stagger]').forEach((group) => {
    const kids = group.querySelectorAll<HTMLElement>('[data-stagger-item]');
    if (!kids.length) return;
    gsap.to(kids, {
      opacity: 1,
      y: 0,
      duration: 1,
      ease: 'expo.out',
      stagger: 0.08,
      scrollTrigger: { trigger: group, start: 'top 82%', once: true },
    });
  });

  // Word-by-word brightening on the intro paragraph.
  //
  // Only above sm. On a phone the paragraph runs ten lines in a short viewport,
  // so a scrubbed reveal leaves most of it sitting at 15% opacity for most of
  // the scroll — it reads as broken text rather than as an effect.
  const intro = document.querySelector<HTMLElement>('[data-words]');
  if (intro && window.matchMedia('(min-width: 640px)').matches) {
    const words = intro.textContent?.trim().split(/\s+/) ?? [];
    intro.innerHTML = words
      .map((w) => `<span class="inline-block opacity-15">${w}</span>`)
      .join(' ');
    gsap.to(intro.querySelectorAll('span'), {
      opacity: 1,
      ease: 'none',
      stagger: 0.5,
      scrollTrigger: {
        trigger: intro,
        start: 'top 78%',
        end: 'bottom 58%',
        scrub: 0.6,
      },
    });
  }
  // No fallback branch: the paragraph ships at full opacity, so skipping the
  // split simply leaves it readable. Adding .rise here would set it back to
  // opacity 0 after the reveal pass had already collected its targets.

  // Parallax on tagged media.
  gsap.utils.toArray<HTMLElement>('[data-parallax]').forEach((el) => {
    const amount = Number(el.dataset.parallax) || 12;
    gsap.fromTo(
      el,
      { yPercent: -amount / 2 },
      {
        yPercent: amount / 2,
        ease: 'none',
        scrollTrigger: { trigger: el.parentElement ?? el, start: 'top bottom', end: 'bottom top', scrub: true },
      },
    );
  });

  // Counters.
  gsap.utils.toArray<HTMLElement>('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    const obj = { v: 0 };
    gsap.to(obj, {
      v: target,
      duration: 2,
      ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      onUpdate: () => {
        el.textContent = Math.round(obj.v).toLocaleString();
      },
    });
  });
}

/* ------------------------------------------------------------------- boot */

export function initMotion() {
  // Tells the inline failsafe in Base.astro to stand down.
  (window as any).__kedMotionReady = true;

  initAccordion();
  initMenu();

  if (REDUCED) {
    gsap.set('.rise, [data-stagger-item], [data-hero-fade]', { opacity: 1, y: 0 });
    gsap.set('[data-hero-line] > span', { y: '0%' });
    initHeader(() => window.scrollY);
    document.querySelectorAll<HTMLElement>('[data-marquee]').forEach((el) => {
      const track = el.querySelector<HTMLElement>('[data-marquee-track]');
      if (track) track.innerHTML += track.innerHTML;
    });
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  const lenis = new Lenis({
    duration: 1.05,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    touchMultiplier: 1.6,
  });

  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  initHeader(() => lenis.scroll);

  // In-page links go through Lenis so the easing matches the rest of the site.
  // Nav hrefs are root-relative ("/#work") so they also work from /store, so
  // match on the resolved URL rather than on a leading "#".
  document.querySelectorAll<HTMLAnchorElement>('a[href*="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname !== location.pathname) return; // let the browser navigate
      if (!url.hash || url.hash === '#') return;

      const target = document.querySelector(url.hash);
      if (!target) return;

      e.preventDefault();
      lenis.scrollTo(target as HTMLElement, { offset: -80, duration: 1.2 });
      history.pushState(null, '', url.hash);
    });
  });

  initReveals();
  initMarquee();
  initTilt();

  // Images finish decoding after first paint and shift trigger positions. Lazy
  // images keep doing that well after load, so refresh on each batch that lands.
  let refreshQueued = false;
  const queueRefresh = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      setTimeout(() => {
        ScrollTrigger.refresh();
        refreshQueued = false;
      }, 120);
    });
  };

  window.addEventListener('load', queueRefresh);
  document.querySelectorAll('img').forEach((img) => {
    if (!img.complete) img.addEventListener('load', queueRefresh, { once: true });
  });
}
