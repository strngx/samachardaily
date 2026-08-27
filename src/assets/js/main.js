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

  // 5. Newsletter Form Inline Feedback
  const newsletterForm = document.getElementById("newsletter-form");
  if (newsletterForm) {
    newsletterForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const emailInput = newsletterForm.querySelector('input[type="email"]');
      const submitBtn = newsletterForm.querySelector('button[type="submit"]');
      
      if (emailInput && emailInput.value) {
        const originalText = submitBtn.textContent;
        submitBtn.textContent = "Subscribed!";
        submitBtn.disabled = true;
        submitBtn.style.backgroundColor = "#1E8A4C";
        emailInput.value = "";
        
        setTimeout(() => {
          submitBtn.textContent = originalText;
          submitBtn.disabled = false;
          submitBtn.style.backgroundColor = "";
        }, 4000);
      }
    });
  }
});
