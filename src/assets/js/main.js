/**
 * SamacharDaily — Live Newsroom Client Engine
 * Lightweight, accessible, zero-dependency, Core Web Vitals optimized
 */

function initSamacharDaily() {
  // 1. Sticky Header Compact Mode on Scroll
  const header = document.getElementById("site-header");
  if (header) {
    const onScroll = () => {
      if (window.scrollY > 30) {
        header.classList.add("is-compact");
      } else {
        header.classList.remove("is-compact");
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // 2. Full-Width Top-Down Mobile Navigation Sheet
  const menuToggleBtn = document.getElementById("mobile-menu-btn");
  const navSheet = document.getElementById("mobile-nav-sheet");
  const closeNavBtn = document.getElementById("close-mobile-nav");
  const closeNavActionBtn = document.getElementById("close-mobile-nav-action");
  const searchToggleBtn = document.getElementById("search-toggle");
  const searchDrawer = document.getElementById("search-drawer");
  const searchInput = document.getElementById("search-input");

  function openMobileNav() {
    if (!navSheet) return;
    // Close search if open
    closeSearchDrawer();
    navSheet.classList.add("is-open");
    document.body.classList.add("nav-locked");
    document.documentElement.classList.add("nav-locked");
    if (menuToggleBtn) {
      menuToggleBtn.classList.add("is-active");
      menuToggleBtn.setAttribute("aria-expanded", "true");
      menuToggleBtn.setAttribute("aria-label", "Close navigation menu");
    }
  }

  function closeMobileNav() {
    if (!navSheet) return;
    navSheet.classList.remove("is-open");
    document.body.classList.remove("nav-locked");
    document.documentElement.classList.remove("nav-locked");
    if (menuToggleBtn) {
      menuToggleBtn.classList.remove("is-active");
      menuToggleBtn.setAttribute("aria-expanded", "false");
      menuToggleBtn.setAttribute("aria-label", "Open navigation menu");
    }
  }

  // Idle prefetch of search index (Phase 10)
  let searchIndexPrefetched = false;
  function prefetchSearchIndex() {
    if (searchIndexPrefetched || window.__SEARCH_INDEX_PROMISE__) return;
    searchIndexPrefetched = true;
    const fetchPromise = fetch('/search-index.json')
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        window.__SAMACHAR_SEARCH_INDEX__ = data;
        return data;
      })
      .catch(() => []);
    window.__SEARCH_INDEX_PROMISE__ = fetchPromise;
  }

  function openSearchDrawer() {
    if (!searchDrawer) return;
    // Close mobile nav if open
    closeMobileNav();
    prefetchSearchIndex();
    searchDrawer.classList.add("is-open");
    if (searchToggleBtn) {
      searchToggleBtn.setAttribute("aria-expanded", "true");
    }
    if (searchInput) {
      setTimeout(() => searchInput.focus(), 60);
    }
  }

  function closeSearchDrawer() {
    if (!searchDrawer) return;
    searchDrawer.classList.remove("is-open");
    if (searchToggleBtn) {
      searchToggleBtn.setAttribute("aria-expanded", "false");
    }
  }

  if (menuToggleBtn) {
    menuToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (navSheet && navSheet.classList.contains("is-open")) {
        closeMobileNav();
      } else {
        openMobileNav();
      }
    });
  }

  if (closeNavBtn) {
    closeNavBtn.addEventListener("click", closeMobileNav);
  }

  if (closeNavActionBtn) {
    closeNavActionBtn.addEventListener("click", closeMobileNav);
  }

  if (navSheet) {
    navSheet.addEventListener("click", (e) => {
      // Close if clicking outside the panel (e.g. backdrop overlay)
      const panel = navSheet.querySelector(".mobile-nav-panel");
      if (panel && !panel.contains(e.target)) {
        closeMobileNav();
      } else if (e.target === navSheet) {
        closeMobileNav();
      }
    });

    // Close when clicking any nav link inside mobile sheet
    navSheet.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMobileNav);
    });
  }

  // 3. Search Drawer Toggle
  if (searchToggleBtn && searchDrawer) {
    searchToggleBtn.addEventListener("mouseenter", prefetchSearchIndex, { once: true });
    searchToggleBtn.addEventListener("focus", prefetchSearchIndex, { once: true });

    searchToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (searchDrawer.classList.contains("is-open")) {
        closeSearchDrawer();
      } else {
        openSearchDrawer();
      }
    });

    // Close search drawer when clicking outside
    document.addEventListener("click", (e) => {
      if (searchDrawer.classList.contains("is-open")) {
        if (!searchDrawer.contains(e.target) && !searchToggleBtn.contains(e.target)) {
          closeSearchDrawer();
        }
      }
    });
  }

  // 4. Escape Key Listener for Accessibility (closes both nav and search)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMobileNav();
      closeSearchDrawer();
    }
  });

  // 5. Newsletter Form Submission to Google Forms
  const newsletterForms = document.querySelectorAll(".newsletter-form-inline, #newsletter-form");
  newsletterForms.forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const emailInput = form.querySelector('input[type="email"]');
      if (!emailInput || !emailInput.value || !emailInput.checkValidity()) {
        if (emailInput && typeof emailInput.reportValidity === "function") {
          emailInput.reportValidity();
        }
        return;
      }

      const emailValue = emailInput.value.trim();
      const formAction = form.getAttribute("action") || "https://docs.google.com/forms/d/e/1FAIpQLSeyzXuXR7S7dYrYmKuFeErbXE2O8DTmfMY3RARMlp4bkGNe3A/formResponse";
      const fieldName = emailInput.getAttribute("name") || "entry.963532165";

      const formData = new FormData();
      formData.append(fieldName, emailValue);

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Subscribing...";
      }

      try {
        await fetch(formAction, {
          method: "POST",
          mode: "no-cors",
          body: formData
        });
      } catch (err) {
        console.error("Newsletter submission error:", err);
      }

      const successWrapper = document.createElement("div");
      successWrapper.className = "newsletter-text";
      successWrapper.innerHTML = "<p style=\"font-weight: 700; color: var(--color-ink); margin: 0;\">Thanks! You're subscribed.</p>";

      form.replaceWith(successWrapper);
    });
  });

  // 6. Dynamic Hero Carousel (Phase 13E Autoplay Lifecycle Repair)
  const heroCarousel = document.getElementById("hero-carousel");
  if (heroCarousel) {
    const track = document.getElementById("hero-carousel-track");
    const slides = Array.from(heroCarousel.querySelectorAll(".hero-slide"));
    const prevBtn = document.getElementById("hero-prev-btn");
    const nextBtn = document.getElementById("hero-next-btn");
    const dots = Array.from(heroCarousel.querySelectorAll(".carousel-dot"));

    if (slides.length > 1) {
      let currentIndex = 0;
      let autoplayTimer = null;
      let isHoverPaused = false;
      let isTouchActive = false;
      let lastTouchTimestamp = 0;
      const AUTOPLAY_INTERVAL = 5000; // 5 seconds deterministic auto-advance

      // Clear any prior timer instance across reinitializations
      if (window.__HERO_AUTOPLAY_TIMER__) {
        clearInterval(window.__HERO_AUTOPLAY_TIMER__);
        window.__HERO_AUTOPLAY_TIMER__ = null;
      }

      function checkReducedMotion() {
        return typeof window.matchMedia === "function" &&
               window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      }

      function syncArrowPosition() {
        const activeMedia = heroCarousel.querySelector(".hero-slide.is-active .lead-media-wrap") || heroCarousel.querySelector(".lead-media-wrap");
        if (activeMedia) {
          const rect = activeMedia.getBoundingClientRect();
          const carouselRect = heroCarousel.getBoundingClientRect();
          const topOffset = (rect.top - carouselRect.top) + (rect.height / 2);
          if (topOffset > 0) {
            heroCarousel.style.setProperty("--hero-arrow-top", `${Math.round(topOffset)}px`);
          }
        }
      }

      function updateSlide(index) {
        currentIndex = (index + slides.length) % slides.length;

        // Slide track shift:
        // When prefers-reduced-motion is active, transition is set to instant/none
        // while continuing slide advancement
        if (track) {
          if (checkReducedMotion()) {
            track.style.transition = "none";
          } else {
            track.style.transition = "";
          }
          track.style.transform = `translateX(-${currentIndex * 100}%)`;
        }

        slides.forEach((slide, idx) => {
          const isActive = idx === currentIndex;
          slide.classList.toggle("is-active", isActive);
          slide.setAttribute("aria-hidden", isActive ? "false" : "true");
        });

        dots.forEach((dot, idx) => {
          const isActive = idx === currentIndex;
          dot.classList.toggle("is-active", isActive);
          dot.setAttribute("aria-selected", isActive ? "true" : "false");
        });

        syncArrowPosition();
      }

      function stopAutoplay() {
        if (autoplayTimer !== null) {
          clearInterval(autoplayTimer);
          autoplayTimer = null;
        }
        if (window.__HERO_AUTOPLAY_TIMER__) {
          clearInterval(window.__HERO_AUTOPLAY_TIMER__);
          window.__HERO_AUTOPLAY_TIMER__ = null;
        }
      }

      function startAutoplay() {
        // Enforce strictly one active timer
        stopAutoplay();
        // Do not rotate if document is hidden or touch gesture is active
        if (document.hidden || isTouchActive) {
          return;
        }
        // Recover from synthetic hover if pointer is not actually over the carousel
        if (isHoverPaused) {
          try {
            if (!heroCarousel.matches(":hover")) {
              isHoverPaused = false;
            }
          } catch (_) {
            isHoverPaused = false;
          }
        }
        if (isHoverPaused) {
          return;
        }
        autoplayTimer = setInterval(() => {
          updateSlide(currentIndex + 1);
        }, AUTOPLAY_INTERVAL);
        window.__HERO_AUTOPLAY_TIMER__ = autoplayTimer;
      }

      function restartAutoplay() {
        startAutoplay();
      }

      function handleManualNav(newIndex) {
        // User interaction immediately shows requested slide and resets rotation timer
        isHoverPaused = false;
        isTouchActive = false;
        updateSlide(newIndex);
        restartAutoplay();
      }

      // Prev & Next Buttons
      if (prevBtn) {
        prevBtn.addEventListener("click", () => {
          handleManualNav(currentIndex - 1);
        });
      }

      if (nextBtn) {
        nextBtn.addEventListener("click", () => {
          handleManualNav(currentIndex + 1);
        });
      }

      // Clickable Slide Dots
      dots.forEach((dot, idx) => {
        dot.addEventListener("click", () => {
          handleManualNav(idx);
        });
      });

      // Pointer-aware Hover Handling:
      // ONLY pause for authentic physical mouse hover; ignore touch-synthesized pointer events
      heroCarousel.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "mouse" && (Date.now() - lastTouchTimestamp > 1200)) {
          isHoverPaused = true;
          stopAutoplay();
        }
      });

      heroCarousel.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse") {
          isHoverPaused = false;
          restartAutoplay();
        }
      });

      // Recover from mouse leaving the viewport without triggering pointerleave
      document.addEventListener("mouseleave", () => {
        if (isHoverPaused) {
          isHoverPaused = false;
          restartAutoplay();
        }
      });

      // Clicking anywhere on carousel (article links, cards, controls) resets any synthetic hover lock
      heroCarousel.addEventListener("click", () => {
        setTimeout(() => {
          try {
            if (!heroCarousel.matches(":hover")) {
              isHoverPaused = false;
            }
          } catch (_) {
            isHoverPaused = false;
          }
          restartAutoplay();
        }, 60);
      });

      // Accessible Focus Handling:
      // Only pause while a control is explicitly focused via keyboard navigation (:focus-visible)
      // Mouse/touch clicks on links and buttons do NOT lock autoplay
      heroCarousel.addEventListener("focusin", (e) => {
        try {
          if (e.target && typeof e.target.matches === "function" && e.target.matches(":focus-visible")) {
            isHoverPaused = true;
            stopAutoplay();
          }
        } catch (_) {}
      });

      heroCarousel.addEventListener("focusout", (e) => {
        try {
          if (!heroCarousel.contains(e.relatedTarget) || !e.relatedTarget.matches(":focus-visible")) {
            isHoverPaused = false;
            restartAutoplay();
          }
        } catch (_) {
          isHoverPaused = false;
          restartAutoplay();
        }
      });

      // Touch / Swipe Navigation: pause during gesture, ALWAYS resume on touchend / touchcancel
      let touchStartX = 0;
      let touchStartY = 0;

      heroCarousel.addEventListener("touchstart", (e) => {
        lastTouchTimestamp = Date.now();
        isTouchActive = true;
        stopAutoplay();
        if (e.touches && e.touches.length > 0) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }
      }, { passive: true });

      heroCarousel.addEventListener("touchend", (e) => {
        lastTouchTimestamp = Date.now();
        isTouchActive = false;
        isHoverPaused = false; // Never let touch leave persistent hover lock
        if (e.changedTouches && e.changedTouches.length > 0) {
          const touchEndX = e.changedTouches[0].clientX;
          const touchEndY = e.changedTouches[0].clientY;
          const diffX = touchStartX - touchEndX;
          const diffY = touchStartY - touchEndY;

          if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
            if (diffX > 0) {
              updateSlide(currentIndex + 1);
            } else {
              updateSlide(currentIndex - 1);
            }
          }
        }
        restartAutoplay();
      }, { passive: true });

      heroCarousel.addEventListener("touchcancel", () => {
        lastTouchTimestamp = Date.now();
        isTouchActive = false;
        isHoverPaused = false;
        restartAutoplay();
      }, { passive: true });

      // Keyboard Navigation (Left Arrow / Right Arrow)
      heroCarousel.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          handleManualNav(currentIndex - 1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          handleManualNav(currentIndex + 1);
        }
      });

      // Tab Visibility Lifecycle: pause while hidden, resume on reveal
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          stopAutoplay();
        } else {
          isHoverPaused = false;
          isTouchActive = false;
          restartAutoplay();
        }
      });

      // Window Focus & Blur: window blur must NOT permanently stop autoplay
      window.addEventListener("focus", () => {
        if (!document.hidden) {
          isHoverPaused = false;
          isTouchActive = false;
          restartAutoplay();
        }
      });

      // Resize and Zoom handling: keeps arrows positioned and ensures autoplay continues
      window.addEventListener("resize", syncArrowPosition);
      if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(syncArrowPosition).observe(heroCarousel);
      }

      // Initial state
      updateSlide(0);
      syncArrowPosition();
      startAutoplay();
    }
  }

  // 7. Accessible Article Social Share Interactions (Phase 13B)
  const nativeShareBtn = document.getElementById("native-share-btn");
  if (nativeShareBtn && typeof navigator !== "undefined" && typeof navigator.share === "function") {
    // Reveal native share button on mobile / supported devices
    nativeShareBtn.style.display = "inline-flex";
    nativeShareBtn.addEventListener("click", async () => {
      const shareUrl = nativeShareBtn.getAttribute("data-url") || window.location.href;
      const shareTitle = nativeShareBtn.getAttribute("data-title") || document.title;
      try {
        await navigator.share({
          title: shareTitle,
          url: shareUrl
        });
      } catch (err) {
        // AbortError is normal when user cancels dialog; ignore
        if (err && err.name !== "AbortError") {
          console.warn("Native share error:", err);
        }
      }
    });
  }

  const copyShareBtn = document.getElementById("copy-share-btn");
  const copyFeedback = document.getElementById("copy-feedback");
  const copyBtnText = document.getElementById("copy-btn-text");
  if (copyShareBtn) {
    let copyResetTimer = null;
    copyShareBtn.addEventListener("click", async () => {
      const urlToCopy = copyShareBtn.getAttribute("data-url") || window.location.href;
      let success = false;

      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        try {
          await navigator.clipboard.writeText(urlToCopy);
          success = true;
        } catch (_) {
          success = false;
        }
      }

      // Safe fallback if clipboard API failed or is not available
      if (!success) {
        try {
          const tempInput = document.createElement("textarea");
          tempInput.value = urlToCopy;
          tempInput.setAttribute("readonly", "");
          tempInput.style.position = "fixed";
          tempInput.style.opacity = "0";
          tempInput.style.left = "-9999px";
          document.body.appendChild(tempInput);
          tempInput.select();
          success = document.execCommand("copy");
          document.body.removeChild(tempInput);
        } catch (_) {
          success = false;
        }
      }

      if (success) {
        if (copyFeedback) copyFeedback.classList.add("is-visible");
        copyShareBtn.classList.add("is-copied");
        const copyIcon = copyShareBtn.querySelector(".copy-icon");
        const checkIcon = copyShareBtn.querySelector(".check-icon");
        if (copyIcon) copyIcon.style.display = "none";
        if (checkIcon) checkIcon.style.display = "inline-block";
        if (copyBtnText) copyBtnText.textContent = "Copied!";

        clearTimeout(copyResetTimer);
        copyResetTimer = setTimeout(() => {
          if (copyFeedback) copyFeedback.classList.remove("is-visible");
          copyShareBtn.classList.remove("is-copied");
          if (copyIcon) copyIcon.style.display = "inline-block";
          if (checkIcon) checkIcon.style.display = "none";
          if (copyBtnText) copyBtnText.textContent = "Copy Link";
        }, 2200);
      }
    });
  }

  // 11. Newsletter Subscription Handler (Phase J)
  const newsletterForm = document.getElementById("newsletter-form");
  if (newsletterForm) {
    newsletterForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = newsletterForm.querySelector(".newsletter-input-field");
      const btn = newsletterForm.querySelector(".newsletter-submit-btn");
      const feedback = document.getElementById("newsletter-feedback");
      if (!input || !input.value.trim()) return;

      const email = input.value.trim();
      const origText = btn ? btn.textContent : "Subscribe";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Subscribing...";
      }
      if (feedback) {
        feedback.textContent = "";
        feedback.className = "newsletter-feedback";
      }

      try {
        const resp = await fetch("/api/newsletter/subscribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({ email, source: "web" })
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.success) {
          if (feedback) {
            feedback.textContent = data.message || "Thank you for subscribing!";
            feedback.className = "newsletter-feedback is-success";
          }
          input.value = "";
        } else {
          if (feedback) {
            feedback.textContent = data.error || "Subscription failed. Please check your email.";
            feedback.className = "newsletter-feedback is-error";
          }
        }
      } catch (err) {
        if (feedback) {
          feedback.textContent = "Unable to connect. Please try again shortly.";
          feedback.className = "newsletter-feedback is-error";
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = origText;
        }
      }
    });
  }
}

 
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSamacharDaily);
} else {
  initSamacharDaily();
}

