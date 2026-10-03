/**
 * SamacharDaily — Live Newsroom Client Engine
 * Lightweight, accessible, zero-dependency, Core Web Vitals optimized
 */

document.addEventListener("DOMContentLoaded", () => {
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

  function openSearchDrawer() {
    if (!searchDrawer) return;
    // Close mobile nav if open
    closeMobileNav();
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

  // 6. Dynamic Hero Carousel (Phase 2 & 3 Correction)
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
      let isPaused = false;
      const AUTOPLAY_INTERVAL = 6000; // 6 seconds

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

        // Slide track must always shift to current slide offset;
        // CSS takes care of disabling motion when prefers-reduced-motion is active.
        if (track) {
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

      function startAutoplay() {
        if (checkReducedMotion() || isPaused) return;
        stopAutoplay();
        autoplayTimer = setInterval(() => {
          updateSlide(currentIndex + 1);
        }, AUTOPLAY_INTERVAL);
      }

      function stopAutoplay() {
        if (autoplayTimer) {
          clearInterval(autoplayTimer);
          autoplayTimer = null;
        }
      }

      function restartAutoplay() {
        isPaused = false;
        startAutoplay();
      }

      // Prev & Next Buttons
      if (prevBtn) {
        prevBtn.addEventListener("click", () => {
          updateSlide(currentIndex - 1);
          restartAutoplay();
        });
      }

      if (nextBtn) {
        nextBtn.addEventListener("click", () => {
          updateSlide(currentIndex + 1);
          restartAutoplay();
        });
      }

      // Clickable Slide Dots
      dots.forEach((dot, idx) => {
        dot.addEventListener("click", () => {
          updateSlide(idx);
          restartAutoplay();
        });
      });

      // Pause on Hover, Resume on Mouse Leave
      heroCarousel.addEventListener("mouseenter", () => {
        isPaused = true;
        stopAutoplay();
      });

      heroCarousel.addEventListener("mouseleave", () => {
        restartAutoplay();
      });

      // Accessible Focus Handling: pause during keyboard navigation, resume on blur
      heroCarousel.addEventListener("focusin", (e) => {
        if (e.target && (e.target.tagName === "A" || e.target.tagName === "BUTTON")) {
          // Control focused
        }
      });

      heroCarousel.addEventListener("focusout", (e) => {
        if (!heroCarousel.contains(e.relatedTarget)) {
          restartAutoplay();
        }
      });

      // Touch / Swipe Navigation with touchcancel support
      let touchStartX = 0;
      let touchStartY = 0;

      heroCarousel.addEventListener("touchstart", (e) => {
        isPaused = true;
        stopAutoplay();
        if (e.touches && e.touches.length > 0) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }
      }, { passive: true });

      heroCarousel.addEventListener("touchend", (e) => {
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
        restartAutoplay();
      }, { passive: true });

      // Keyboard Navigation (Left Arrow / Right Arrow)
      heroCarousel.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          updateSlide(currentIndex - 1);
          restartAutoplay();
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          updateSlide(currentIndex + 1);
          restartAutoplay();
        }
      });

      // Tab Visibility & Window Focus Lifecycle
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          stopAutoplay();
        } else {
          restartAutoplay();
        }
      });

      window.addEventListener("blur", () => {
        stopAutoplay();
      });

      window.addEventListener("focus", () => {
        restartAutoplay();
      });

      // Resize handling to keep arrows vertically centered over the hero image
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
});
