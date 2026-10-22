import { Component } from '@theme/component';
import {
  supportsViewTransitions,
  startViewTransition,
  onAnimationEnd,
  prefersReducedMotion,
  debounce,
  preloadImage,
  isLowPowerDevice,
} from '@theme/utilities';
import { scrollIntoView } from '@theme/scrolling';
import { ZoomMediaSelectedEvent } from '@theme/events';
import { DialogCloseEvent } from '@theme/dialog';
/**
 * A custom element that renders a zoom dialog.
 *
 * @typedef {object} Refs
 * @property {HTMLDialogElement} dialog - The dialog element.
 * @property {HTMLElement[]} media - The media elements.
 * @property {HTMLElement} thumbnails - The thumbnails elements.
 *
 * @extends Component<Refs>
 */
export class ZoomDialog extends Component {
  requiredRefs = ['dialog', 'media', 'thumbnails'];

  #highResImagesLoaded = /** @type {Set<string>} */ (new Set());
  #isLooping = false;
  /** @type {HTMLElement | null} */
  #activePlaceholder = null;
  /** @type {HTMLElement | null} */
  #activeTargetSlide = null;

  #touchStartX = 0;
  #touchStartY = 0;
  #touchStartTime = 0;
  #touchMoved = false;

  connectedCallback() {
    super.connectedCallback();
    this.refs.dialog.addEventListener('scroll', this.handleScroll, { passive: true });
    const gallery = this.querySelector('.dialog-zoomed-gallery');
    gallery?.addEventListener('scroll', this.handleScroll, { passive: true });

    gallery?.addEventListener('touchstart', this.#handleTouchStart, { passive: true });
    gallery?.addEventListener('touchmove', this.#handleTouchMove, { passive: false });
    gallery?.addEventListener('touchend', this.#handleTouchEnd, { passive: true });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#cleanupLoop();
    this.refs.dialog.removeEventListener('scroll', this.handleScroll);
    const gallery = this.querySelector('.dialog-zoomed-gallery');
    gallery?.removeEventListener('scroll', this.handleScroll);

    gallery?.removeEventListener('touchstart', this.#handleTouchStart);
    gallery?.removeEventListener('touchmove', this.#handleTouchMove);
    gallery?.removeEventListener('touchend', this.#handleTouchEnd);
  }

  #handleTouchStart = (event) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    this.#touchStartX = touch.clientX;
    this.#touchStartY = touch.clientY;
    this.#touchStartTime = performance.now();
    this.#touchMoved = false;
  };

  #handleTouchMove = (event) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    const deltaX = touch.clientX - this.#touchStartX;
    const deltaY = touch.clientY - this.#touchStartY;

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      this.#touchMoved = true;
      if (event.cancelable) event.preventDefault();
    }
  };

  #handleTouchEnd = (event) => {
    if (!this.#touchMoved) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const deltaX = touch.clientX - this.#touchStartX;
    const deltaY = touch.clientY - this.#touchStartY;
    const deltaTime = performance.now() - this.#touchStartTime;

    const isQuickSwipe = deltaTime < 400 && Math.abs(deltaX) > 25;
    const isLongSwipe = Math.abs(deltaX) > 40;

    if ((isQuickSwipe || isLongSwipe) && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX < 0) {
        this.nextImage();
      } else {
        this.previousImage();
      }
    }
  };

  /**
   * Opens the zoom dialog.
   *
   * @param {number} index - The index of the media to zoom.
   * @param {PointerEvent} [event] - The pointer event.
   */
  async open(index, event) {
    event?.preventDefault?.();

    const targetIndex = typeof index === 'number' ? index : 0;
    const { dialog, media, thumbnails } = this.refs;
    const targetImage = media[targetIndex];
    const targetThumbnail = thumbnails?.children?.[targetIndex];

    this.#cleanupLoop();
    dialog.classList.remove('dialog--closing');
    const closeBtn = dialog.querySelector('.dialog-zoomed-gallery__close-button');
    if (closeBtn) closeBtn.style.display = '';
    const pill = dialog.querySelector('.pswp__counter-pill');
    if (pill) pill.style.display = '';

    // Reset any transforms or running animations from previous zoom sessions
    for (const item of media) {
      const img = item.querySelector('img');
      if (img) {
        img.getAnimations?.().forEach((anim) => anim.cancel());
        img.style.transform = '';
        img.style.borderRadius = '';
      }
    }

    dialog.showModal();

    const pillCurrent = dialog.querySelector('.pswp__pill-current');
    if (pillCurrent) {
      pillCurrent.textContent = String(targetIndex + 1);
    }

    const container = this.querySelector('.dialog-zoomed-gallery') || dialog;
    if (targetImage && container) {
      container.scrollTo({
        left: targetImage.offsetLeft,
        behavior: 'instant',
      });
      this.loadHighResolutionImage(targetImage);
    }

    if (targetThumbnail && thumbnails) {
      scrollIntoView(targetThumbnail, {
        ancestor: thumbnails,
        behavior: 'instant',
        block: 'center',
        inline: 'center',
      });
    }

    this.selectThumbnail(targetIndex, { behavior: 'instant' });
  }

  /**
   * Loads a high-resolution image for a specific media container
   * @param {HTMLElement} mediaContainer - The media container element
   */
  loadHighResolutionImage(mediaContainer) {
    if (!mediaContainer.classList.contains('product-media-container--image')) return false;

    const image = mediaContainer.querySelector('img.product-media__image');
    if (!image || !(image instanceof HTMLImageElement)) return false;

    const highResolutionUrl = image.getAttribute('data_max_resolution');
    if (!highResolutionUrl || this.#highResImagesLoaded.has(highResolutionUrl)) return false;

    preloadImage(highResolutionUrl);

    const newImage = new Image();
    newImage.className = image.className;
    newImage.alt = image.alt;
    newImage.setAttribute('data_max_resolution', highResolutionUrl);
    newImage.setAttribute('ref', 'image');

    // When the high-resolution image loads, replace the existing image
    newImage.onload = () => {
      image.replaceWith(newImage);
      this.#highResImagesLoaded.add(highResolutionUrl);
    };

    newImage.src = highResolutionUrl;
  }

  /**
   * Handles the scroll event of the dialog, which is used to update the active thumbnail when the corresponding image is visible in the main view.
   * @param {Event} event - The scroll event.
   */
  handleScroll = debounce(async () => {
    if (this.#isLooping) return;
    const { media, thumbnails } = this.refs;

    const mostVisibleElement = await getMostVisibleElement(media);
    const activeIndex = media.indexOf(mostVisibleElement);
    const targetThumbnail = thumbnails.children[activeIndex];

    if (!targetThumbnail || !(targetThumbnail instanceof HTMLElement)) return;

    Array.from(thumbnails.querySelectorAll('button')).forEach((button, i) => {
      button.setAttribute('aria-selected', `${i === activeIndex}`);
    });

    const pillCurrent = this.querySelector('.pswp__pill-current');
    if (pillCurrent && activeIndex >= 0) {
      pillCurrent.textContent = String(activeIndex + 1);
    }

    this.loadHighResolutionImage(mostVisibleElement);
    this.dispatchEvent(new ZoomMediaSelectedEvent(activeIndex));
  }, 50);

  /**
   * Closes the zoom dialog with an exact FLIP animation that smoothly shrinks
   * the active zoomed image directly into the target slide's exact bounds.
   */
  async close() {
    this.#cleanupLoop();
    const { dialog, media } = this.refs;
    if (!dialog || !dialog.open || dialog.classList.contains('dialog--closing')) return;

    if (prefersReducedMotion()) {
      this.closeDialog();
      return;
    }

    // 0. Hide dialog background, close button, and counter IMMEDIATELY on first interaction
    dialog.classList.add('dialog--closing');
    const closeBtn = dialog.querySelector('.dialog-zoomed-gallery__close-button');
    if (closeBtn) closeBtn.style.display = 'none';
    const pill = dialog.querySelector('.pswp__counter-pill');
    if (pill) pill.style.display = 'none';

    try {
      // 1. Identify the currently active zoomed image synchronously (0ms delay!)
      const activeIndex = this.#getCurrentIndex();
      const mostVisibleElement = media[activeIndex] || media[0];

      // 2. Find the corresponding target slide / image on the page
      const mediaGallery = /** @type {import('./media-gallery').MediaGallery | null} */ (
        this.closest('media-gallery')
      );

      // Sync slideshow on the page if present
      if (mediaGallery?.slideshow && typeof mediaGallery.slideshow.select === 'function') {
        mediaGallery.slideshow.select(activeIndex, undefined, { animate: false });
      }

      const slideshowActive = mediaGallery?.presentation === 'carousel';
      const targetSlide = slideshowActive
        ? mediaGallery.slideshow?.slides?.[activeIndex]
        : mediaGallery?.media?.[activeIndex];

      const targetImg = targetSlide?.querySelector('img.product-media__image, img') || targetSlide;
      const zoomImg = mostVisibleElement?.querySelector('img.product-media__image, img') || mostVisibleElement;

      if (!targetImg || !zoomImg) {
        this.closeDialog();
        return;
      }

      const targetRect = targetImg.getBoundingClientRect();
      const zoomRect = zoomImg.getBoundingClientRect();

      // If targetRect is invalid or offscreen, fall back to simple close
      if (!targetRect.width || !targetRect.height || !zoomRect.width || !zoomRect.height) {
        this.closeDialog();
        return;
      }

      // 3. Calculate exact translation and scale
      const scaleX = targetRect.width / zoomRect.width;
      const scaleY = targetRect.height / zoomRect.height;
      const zoomCenterX = zoomRect.left + zoomRect.width / 2;
      const zoomCenterY = zoomRect.top + zoomRect.height / 2;
      const targetCenterX = targetRect.left + targetRect.width / 2;
      const targetCenterY = targetRect.top + targetRect.height / 2;
      const deltaX = targetCenterX - zoomCenterX;
      const deltaY = targetCenterY - zoomCenterY;

      // 4. Animate the zoomed image directly into targetRect
      zoomImg.style.transformOrigin = 'center center';
      const targetRadius = getComputedStyle(targetImg).borderRadius || '0px';

      const animation = zoomImg.animate(
        [
          { transform: 'translate(0px, 0px) scale(1, 1)', borderRadius: '0px', opacity: 1 },
          { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`, borderRadius: targetRadius, opacity: 1 },
        ],
        {
          duration: 320,
          easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
          fill: 'forwards',
        }
      );

      try {
        await animation.finished;
      } catch {
        // Ignore if cancelled
      } finally {
        this.closeDialog();
        dialog.classList.remove('dialog--closing');
        if (closeBtn) closeBtn.style.display = '';
        if (pill) pill.style.display = '';
        animation.cancel();
        zoomImg.style.transform = '';
        zoomImg.style.borderRadius = '';
      }
    } catch {
      this.closeDialog();
      dialog.classList.remove('dialog--closing');
      if (closeBtn) closeBtn.style.display = '';
      if (pill) pill.style.display = '';
    }
  }

  closeDialog() {
    const { dialog } = this.refs;
    dialog.close();
    window.dispatchEvent(new DialogCloseEvent());
  }

  /**
   * Closes the dialog when the user presses the escape key.
   *
   * @param {KeyboardEvent} event - The keyboard event.
   */
  handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.previousImage(event);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.nextImage(event);
    }
  }

  /**
   * Helper to get the current slide index synchronously from scrollLeft
   * @returns {number}
   */
  #getCurrentIndex() {
    const container = this.querySelector('.dialog-zoomed-gallery') || this.refs.dialog;
    const { media } = this.refs;
    if (!container || !media || !media.length) return 0;
    const slideWidth = container.clientWidth || window.innerWidth;
    if (slideWidth > 0) {
      const idx = Math.round(container.scrollLeft / slideWidth);
      return Math.max(0, Math.min(media.length - 1, idx));
    }
    return 0;
  }

  /**
   * Cleans up any in-flight loop state and restores DOM
   */
  #cleanupLoop() {
    if (this.#activePlaceholder && this.#activeTargetSlide) {
      this.#activePlaceholder.replaceWith(this.#activeTargetSlide);
      this.#activePlaceholder = null;
      this.#activeTargetSlide = null;
    }
    const container = this.querySelector('.dialog-zoomed-gallery') || this.refs.dialog;
    if (container) {
      container.style.scrollSnapType = '';
    }
    this.#isLooping = false;
  }

  /**
   * Waits for smooth scrolling to complete
   * @param {HTMLElement} container
   * @returns {Promise<void>}
   */
  #waitForScroll(container) {
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        container.removeEventListener('scrollend', finish);
        if (timer) clearTimeout(timer);
        resolve();
      };

      container.addEventListener('scrollend', finish, { once: true });
      timer = setTimeout(finish, 450);
    });
  }

  /**
   * Smoothly loops to the first or last slide in the specified direction
   * without rewinding across all intermediate slides.
   * @param {'next' | 'previous'} direction
   * @param {number} fromIndex
   * @param {number} toIndex
   */
  async #loopSlide(direction, fromIndex, toIndex) {
    const { media, thumbnails } = this.refs;
    const container = this.querySelector('.dialog-zoomed-gallery') || this.refs.dialog;
    if (!container || !media || media.length <= 1) return;

    if (prefersReducedMotion()) {
      this.selectThumbnail(toIndex, { behavior: 'instant' });
      return;
    }

    this.#isLooping = true;

    const currentSlide = media[fromIndex];
    const targetSlide = media[toIndex];
    if (!currentSlide || !targetSlide) {
      this.#isLooping = false;
      return;
    }

    // Immediately update pill counter and thumbnail selection
    const pillCurrent = this.querySelector('.pswp__pill-current');
    if (pillCurrent) {
      pillCurrent.textContent = String(toIndex + 1);
    }
    if (thumbnails) {
      Array.from(thumbnails.querySelectorAll('button')).forEach((button, i) => {
        button.setAttribute('aria-selected', `${i === toIndex}`);
      });
      const targetThumbnail = thumbnails.children[toIndex];
      if (targetThumbnail instanceof HTMLElement) {
        scrollIntoView(targetThumbnail, {
          ancestor: thumbnails,
          behavior: 'smooth',
          block: 'center',
          inline: 'center',
        });
      }
    }

    // Create a hidden placeholder at targetSlide's original DOM location to preserve spacing
    const placeholder = document.createElement('li');
    placeholder.className = 'pswp__item';
    placeholder.style.cssText = 'visibility: hidden !important; pointer-events: none !important;';
    this.#activePlaceholder = placeholder;
    this.#activeTargetSlide = targetSlide;

    targetSlide.before(placeholder);

    const originalScrollSnap = container.style.scrollSnapType;
    container.style.scrollSnapType = 'none';

    if (direction === 'next') {
      // Place targetSlide right after currentSlide (at end)
      currentSlide.after(targetSlide);
      // Smoothly scroll forward to targetSlide
      container.scrollTo({
        left: targetSlide.offsetLeft,
        behavior: 'smooth',
      });
    } else {
      // Place targetSlide right before currentSlide (at start)
      currentSlide.before(targetSlide);
      // Instantly pin scrollLeft to currentSlide so viewport doesn't jump
      container.scrollLeft = currentSlide.offsetLeft;
      // Wait for the next frame to ensure instant scroll is painted
      await new Promise((r) => requestAnimationFrame(r));
      // Smoothly scroll backward to targetSlide (offsetLeft 0)
      container.scrollTo({
        left: targetSlide.offsetLeft,
        behavior: 'smooth',
      });
    }

    await this.#waitForScroll(container);

    if (!this.#isLooping) return;

    // Restore targetSlide to its original position
    placeholder.replaceWith(targetSlide);
    this.#activePlaceholder = null;
    this.#activeTargetSlide = null;

    // Instantly jump to targetSlide's original offsetLeft (seamless invisible transition)
    container.scrollTo({
      left: targetSlide.offsetLeft,
      behavior: 'instant',
    });

    container.style.scrollSnapType = originalScrollSnap;

    this.loadHighResolutionImage(targetSlide);
    this.dispatchEvent(new ZoomMediaSelectedEvent(toIndex));

    this.#isLooping = false;
  }

  /**
   * Navigates to the previous image in the zoom dialog.
   * @param {Event} [event] - The click event.
   */
  async previousImage(event) {
    event?.preventDefault();
    if (this.#isLooping) return;
    const { media } = this.refs;
    if (!media || !media.length) return;

    const currentIndex = this.#getCurrentIndex();
    if (currentIndex <= 0) {
      await this.#loopSlide('previous', currentIndex, media.length - 1);
    } else {
      const prevIndex = currentIndex - 1;
      this.selectThumbnail(prevIndex, { behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
    }
  }

  /**
   * Navigates to the next image in the zoom dialog.
   * @param {Event} [event] - The click event.
   */
  async nextImage(event) {
    event?.preventDefault();
    if (this.#isLooping) return;
    const { media } = this.refs;
    if (!media || !media.length) return;

    const currentIndex = this.#getCurrentIndex();
    if (currentIndex >= media.length - 1) {
      await this.#loopSlide('next', currentIndex, 0);
    } else {
      const nextIndex = currentIndex + 1;
      this.selectThumbnail(nextIndex, { behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
    }
  }

  /**
   * Handles the click event of a thumbnail.
   * @param {number} index - The index of the thumbnail to select.
   */
  async handleThumbnailClick(index) {
    this.selectThumbnail(index, { behavior: 'instant' });
  }

  /**
   * Handles the pointer enter event of a thumbnail.
   * @param {number} index - The index of the thumbnail to load the high-resolution image for.
   */
  async handleThumbnailPointerEnter(index) {
    const { media } = this.refs;
    if (!media[index]) return;

    this.loadHighResolutionImage(media[index]);
  }

  /**
   * Handles the selection of a thumbnail.
   * @param {number} index - The index of the thumbnail to select.
   * @param {Object} options - The options for the selection.
   * @param {ScrollBehavior} options.behavior - The behavior of the scroll.
   */
  async selectThumbnail(index, options = { behavior: 'smooth' }) {
    if (this.#isLooping) return;
    if (!this.refs.thumbnails || !this.refs.thumbnails.children.length) return;

    // Guard if invalid
    if (isNaN(index) || index < 0 || index >= this.refs.thumbnails.children.length) return;

    const { media, thumbnails } = this.refs;
    const targetThumbnail = thumbnails.children[index];

    if (!targetThumbnail || !(targetThumbnail instanceof HTMLElement)) return;

    Array.from(thumbnails.querySelectorAll('button')).forEach((button, i) => {
      button.setAttribute('aria-selected', `${i === index}`);
    });

    const pillCurrent = this.querySelector('.pswp__pill-current');
    if (pillCurrent) {
      pillCurrent.textContent = String(index + 1);
    }

    scrollIntoView(targetThumbnail, {
      ancestor: thumbnails,
      behavior: options.behavior,
      block: 'center',
      inline: 'center',
    });

    const targetImage = media[index];

    if (targetImage) {
      const container = this.querySelector('.dialog-zoomed-gallery') || this.refs.dialog;
      if (container) {
        container.scrollTo({
          left: targetImage.offsetLeft,
          behavior: options.behavior || 'instant',
        });
      } else {
        targetImage.scrollIntoView({
          behavior: options.behavior || 'instant',
        });
      }

      this.loadHighResolutionImage(targetImage);
    }
    this.dispatchEvent(new ZoomMediaSelectedEvent(index));
  }
}

if (!customElements.get('zoom-dialog')) {
  customElements.define('zoom-dialog', ZoomDialog);
}

/**
 * Get the most visible element from a list of elements.
 * @param {HTMLElement[]} elements - The elements to get the most visible element from.
 * @returns {Promise<HTMLElement>} A promise that resolves to the most visible element.
 */
function getMostVisibleElement(elements) {
  return new Promise((resolve) => {
    const observer = new IntersectionObserver(
      (entries) => {
        const mostVisible = entries.reduce((prev, current) =>
          current.intersectionRatio > prev.intersectionRatio ? current : prev
        );
        observer.disconnect();
        resolve(/** @type {HTMLElement} */ (mostVisible.target));
      },
      {
        threshold: Array.from({ length: 100 }, (_, i) => i / 100),
      }
    );

    for (const element of elements) {
      observer.observe(element);
    }
  });
}
