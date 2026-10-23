import { Component } from '@theme/component';

/**
 * Announcement banner custom element that allows fading between content.
 * Based on the Slideshow component.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} slideshowContainer
 * @property {HTMLElement[]} [slides]
 * @property {HTMLButtonElement} [previous]
 * @property {HTMLButtonElement} [next]
 *
 * @extends {Component<Refs>}
 */
export class AnnouncementBar extends Component {
  #current = 0;
  #isTransitioning = false;

  /**
   * The interval ID for automatic playback.
   * @type {number|undefined}
   */
  #interval = undefined;

  get slides() {
    const refSlides = this.refs.slides;
    if (Array.isArray(refSlides) && refSlides.length) return refSlides;
    if (refSlides instanceof HTMLElement) return [refSlides];
    return Array.from(this.querySelectorAll('.announcement-bar__slide'));
  }

  connectedCallback() {
    super.connectedCallback();

    const slides = this.slides;
    slides.forEach((slide, index) => {
      if (index === 0) {
        slide.classList.add('is-active');
        slide.classList.remove('is-exiting');
        slide.setAttribute('aria-hidden', 'false');
      } else {
        slide.classList.remove('is-active', 'is-exiting');
        slide.setAttribute('aria-hidden', 'true');
      }
    });

    this.addEventListener('mouseenter', this.suspend);
    this.addEventListener('mouseleave', this.resume);
    document.addEventListener('visibilitychange', this.#handleVisibilityChange);

    this.play();
  }

  next() {
    if (this.#isTransitioning) return;
    this.goTo(this.#current + 1);
  }

  previous() {
    if (this.#isTransitioning) return;
    this.goTo(this.#current - 1);
  }

  goTo(newIndex) {
    const slides = this.slides;
    if (slides.length <= 1) return;

    let oldRelativeIndex = this.#current % slides.length;
    if (oldRelativeIndex < 0) oldRelativeIndex += slides.length;

    let relativeIndex = newIndex % slides.length;
    if (relativeIndex < 0) relativeIndex += slides.length;

    if (oldRelativeIndex === relativeIndex) return;

    this.#isTransitioning = true;
    this.#current = newIndex;

    const oldSlide = slides[oldRelativeIndex];
    const newSlide = slides[relativeIndex];

    // Reset newSlide below the view without any transition
    newSlide.style.transition = 'none';
    newSlide.classList.remove('is-active', 'is-exiting');
    newSlide.setAttribute('aria-hidden', 'true');
    void newSlide.offsetHeight; // force reflow

    // Restore CSS transition
    newSlide.style.transition = '';

    // Old slide slides up and fades out
    oldSlide.classList.remove('is-active');
    oldSlide.classList.add('is-exiting');
    oldSlide.setAttribute('aria-hidden', 'true');

    // New slide slides up from bottom and becomes active
    newSlide.classList.add('is-active');
    newSlide.setAttribute('aria-hidden', 'false');

    // After animation completes (500ms): silently reset oldSlide
    setTimeout(() => {
      oldSlide.style.transition = 'none';
      oldSlide.classList.remove('is-exiting');
      void oldSlide.offsetHeight; // force reflow
      oldSlide.style.transition = '';

      this.#isTransitioning = false;
    }, 520);
  }

  /**
   * Starts automatic slide playback.
   * @param {number} [interval] - The time interval in seconds between slides.
   */
  play(interval = this.autoplayInterval) {
    if (!this.autoplay) return;

    this.paused = false;

    this.#interval = setInterval(() => {
      if (this.matches(':hover') || document.hidden) return;

      this.next();
    }, interval);
  }

  /**
   * Pauses automatic slide playback.
   */
  pause() {
    this.paused = true;
    this.suspend();
  }

  get paused() {
    return this.hasAttribute('paused');
  }

  set paused(paused) {
    this.toggleAttribute('paused', paused);
  }

  /**
   * Suspends automatic slide playback.
   */
  suspend() {
    clearInterval(this.#interval);
    this.#interval = undefined;
  }

  /**
   * Resumes automatic slide playback if autoplay is enabled.
   */
  resume() {
    if (!this.autoplay || this.paused) return;

    this.pause();
    this.play();
  }

  get autoplay() {
    return Boolean(this.autoplayInterval);
  }

  get autoplayInterval() {
    const interval = this.getAttribute('autoplay');
    const value = parseInt(`${interval}`, 10);

    if (Number.isNaN(value)) return undefined;

    return value * 1000;
  }

  get current() {
    return this.#current;
  }

  set current(current) {
    this.goTo(current);
  }

  /**
   * Pause the slideshow when the page is hidden.
   */
  #handleVisibilityChange = () => (document.hidden ? this.pause() : this.resume());
}

if (!customElements.get('announcement-bar-component')) {
  customElements.define('announcement-bar-component', AnnouncementBar);
}
