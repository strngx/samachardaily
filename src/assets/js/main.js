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

  function openMobileNav() {
    if (!navSheet) return;
    navSheet.classList.add("is-open");
    document.body.classList.add("nav-locked");
    menuToggleBtn?.setAttribute("aria-expanded", "true");
  }

  function closeMobileNav() {
    if (!navSheet) return;
    navSheet.classList.remove("is-open");
    document.body.classList.remove("nav-locked");
    menuToggleBtn?.setAttribute("aria-expanded", "false");
  }

  if (menuToggleBtn) {
    menuToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (navSheet?.classList.contains("is-open")) {
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
      // Close if clicking on the backdrop
      if (e.target === navSheet) {
        closeMobileNav();
      }
    });

    // Close when clicking any nav link inside mobile sheet
    navSheet.querySelectorAll("a").forEach(link => {
      link.addEventListener("click", closeMobileNav);
    });
  }

  // 3. Escape Key Listener for Accessibility
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMobileNav();
      const searchDrawer = document.getElementById("search-drawer");
      if (searchDrawer?.classList.contains("is-open")) {
        searchDrawer.classList.remove("is-open");
      }
    }
  });

  // 4. Search Drawer Toggle
  const searchToggleBtn = document.getElementById("search-toggle");
  const searchDrawer = document.getElementById("search-drawer");
  const searchInput = document.getElementById("search-input");

  if (searchToggleBtn && searchDrawer) {
    searchToggleBtn.addEventListener("click", () => {
      const isOpen = searchDrawer.classList.toggle("is-open");
      searchToggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      if (isOpen && searchInput) {
        setTimeout(() => searchInput.focus(), 60);
      }
    });
  }

  // 5. Newsletter Form Submission to Google Forms
  const newsletterForms = document.querySelectorAll(".newsletter-form-inline, #newsletter-form");
  newsletterForms.forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const emailInput = form.querySelector('input[type="email"]');
      if (!emailInput || !emailInput.value || !emailInput.checkValidity()) {
        if (emailInput) emailInput.reportValidity();
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
});
