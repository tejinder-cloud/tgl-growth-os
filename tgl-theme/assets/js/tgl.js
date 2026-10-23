(()=>{
  window.dataLayer = window.dataLayer || [];

  // 1. Generic Click Event Tracking
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-tgl-event]");
    if (!el) return;
    window.dataLayer.push({
      event: el.getAttribute("data-tgl-event"),
      cta_position: el.getAttribute("data-tgl-position") || "standard",
      element_text: (el.innerText || "").trim(),
      problem: el.getAttribute("data-tgl-problem") || undefined
    });
  });

  // 2. Sticky Mobile CTA Pill
  const stickyCta = document.querySelector(".tgl-sticky-cta");
  if (stickyCta) {
    let footerInView = false;
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(entries => {
        footerInView = entries.some(entry => entry.isIntersecting);
        updateSticky();
      }, { threshold: 0.05 });
      document.querySelectorAll(".tgl-cta-band, .tgl-site-footer, .tgl-section--cta-band").forEach(el => observer.observe(el));
    }
    function updateSticky() {
      if (window.innerWidth < 768 && window.scrollY > 1200 && !footerInView) {
        stickyCta.classList.add("is-visible");
      } else {
        stickyCta.classList.remove("is-visible");
      }
    }
    window.addEventListener("scroll", updateSticky, { passive: true });
    window.addEventListener("resize", updateSticky, { passive: true });
  }

  // 3. Hero Desk Scene: Scroll-Triggered Explanatory Motion (Once, prefers-reduced-motion respected)
  const deskStage = document.getElementById("tgl-hero-desk");
  if (deskStage) {
    const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      deskStage.classList.add("is-animated");
    } else if ("IntersectionObserver" in window) {
      const deskObserver = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            deskStage.classList.add("is-animated");
            obs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15 });
      deskObserver.observe(deskStage);
    } else {
      deskStage.classList.add("is-animated");
    }
  }

  // 4. "What's Not Working?" Widget (Chips, Search Filter, Event Tracking, Dynamic CTA Destination)
  const wnwWidget = document.querySelector('[data-tgl-widget="problem-picker"]');
  if (wnwWidget) {
    const chips = Array.from(wnwWidget.querySelectorAll(".tgl-wnw-chip"));
    const cards = Array.from(wnwWidget.querySelectorAll(".tgl-wnw-card"));
    const searchInput = wnwWidget.querySelector(".tgl-wnw-search");

    function selectProblem(problemSlug, track = true) {
      let matchedCard = cards.find(card => card.getAttribute("data-card-slug") === problemSlug);
      if (!matchedCard) {
        matchedCard = document.getElementById("card-fallback") || cards[0];
      }

      // Update chips state
      chips.forEach(chip => {
        const isSelected = chip.getAttribute("data-problem") === problemSlug;
        chip.classList.toggle("is-active", isSelected);
        chip.setAttribute("aria-selected", isSelected ? "true" : "false");
      });

      // Update cards visibility
      cards.forEach(card => {
        if (card === matchedCard) {
          card.removeAttribute("hidden");
          card.classList.add("is-active");
        } else {
          card.setAttribute("hidden", "");
          card.classList.remove("is-active");
        }
      });

      // Push tracking event
      if (track) {
        window.dataLayer.push({
          event: "problem_pick",
          problem: problemSlug
        });
      }
    }

    // Chip click handlers
    chips.forEach(chip => {
      chip.addEventListener("click", () => {
        const slug = chip.getAttribute("data-problem");
        if (searchInput) searchInput.value = "";
        selectProblem(slug, true);
      });
    });

    // Keyword Search filter
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const query = searchInput.value.trim().toLowerCase();
        if (!query) {
          const activeChip = chips.find(c => c.classList.contains("is-active")) || chips[0];
          selectProblem(activeChip.getAttribute("data-problem"), false);
          return;
        }

        // Search through chips keywords and text
        const matched = chips.find(chip => {
          const keywords = (chip.getAttribute("data-keywords") || "").toLowerCase();
          const text = (chip.innerText || "").toLowerCase();
          return keywords.includes(query) || text.includes(query);
        });

        if (matched) {
          selectProblem(matched.getAttribute("data-problem"), true);
        } else {
          // Show fallback card
          selectProblem("other", true);
        }
      });
    }
  }
})();
