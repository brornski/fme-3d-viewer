/* nav.js — Shared navigation behavior for all pages
   Hamburger menu, active page, scroll animations, IntersectionObserver */

(function () {
    'use strict';

    // ── Mobile hamburger toggle ──
    const hamburger = document.getElementById('hamburger');
    const mobileMenu = document.getElementById('mobileMenu');
    const mobileOverlay = document.getElementById('mobileOverlay');

    if (hamburger && mobileMenu) {
        hamburger.addEventListener('click', () => {
            const open = hamburger.classList.toggle('open');
            mobileMenu.classList.toggle('open', open);
            if (mobileOverlay) mobileOverlay.classList.toggle('open', open);
            document.body.style.overflow = open ? 'hidden' : '';
        });

        // Close on overlay tap
        if (mobileOverlay) {
            mobileOverlay.addEventListener('click', () => {
                hamburger.classList.remove('open');
                mobileMenu.classList.remove('open');
                mobileOverlay.classList.remove('open');
                document.body.style.overflow = '';
            });
        }

        // Close on link click
        mobileMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                hamburger.classList.remove('open');
                mobileMenu.classList.remove('open');
                if (mobileOverlay) mobileOverlay.classList.remove('open');
                document.body.style.overflow = '';
            });
        });
    }

    // ── Active page highlighting ──
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-link').forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPage || (currentPage === '' && href === 'index.html')) {
            link.classList.add('active');
        }
    });
    document.querySelectorAll('.mobile-nav-link').forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPage || (currentPage === '' && href === 'index.html')) {
            link.classList.add('active');
        }
    });

    // ── Nav scroll effect — solid bg after scroll ──
    const nav = document.getElementById('mainNav');
    if (nav) {
        let navTicking = false;
        window.addEventListener('scroll', () => {
            if (!navTicking) {
                requestAnimationFrame(() => {
                    if (window.scrollY > 60) {
                        nav.classList.add('scrolled');
                    } else {
                        nav.classList.remove('scrolled');
                    }
                    navTicking = false;
                });
                navTicking = true;
            }
        }, { passive: true });
    }

    // ── IntersectionObserver for [data-animate] panels (non-3D pages) ──
    const animatePanels = document.querySelectorAll('[data-animate]');
    if (animatePanels.length > 0 && !document.getElementById('canvas-container')) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                } else if (entry.boundingClientRect.top > 0) {
                    entry.target.classList.remove('visible');
                }
            });
        }, {
            threshold: 0.12,
            rootMargin: '0px 0px -8% 0px'
        });

        animatePanels.forEach(panel => observer.observe(panel));
    }

    // ── Animated count-up for stats ──
    const counters = document.querySelectorAll('[data-count]');
    if (counters.length > 0) {
        const countObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !entry.target.dataset.counted) {
                    entry.target.dataset.counted = 'true';
                    const target = parseInt(entry.target.dataset.count, 10);
                    const suffix = entry.target.dataset.suffix || '';
                    const prefix = entry.target.dataset.prefix || '';
                    const duration = 2000;
                    const start = performance.now();

                    function tick(now) {
                        const elapsed = now - start;
                        const progress = Math.min(elapsed / duration, 1);
                        const eased = 1 - Math.pow(1 - progress, 3);
                        const current = Math.round(target * eased);
                        entry.target.textContent = prefix + current.toLocaleString() + suffix;
                        if (progress < 1) requestAnimationFrame(tick);
                    }
                    requestAnimationFrame(tick);
                }
            });
        }, { threshold: 0.3 });

        counters.forEach(c => countObserver.observe(c));
    }

    // ── FAQ accordion ──
    document.querySelectorAll('.faq-question').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.parentElement;
            const isOpen = item.classList.contains('open');
            // Close all others
            document.querySelectorAll('.faq-item.open').forEach(other => {
                if (other !== item) other.classList.remove('open');
            });
            item.classList.toggle('open', !isOpen);
        });
    });

    // ── Smooth scroll for same-page anchor links ──
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            const target = document.querySelector(anchor.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });

})();
