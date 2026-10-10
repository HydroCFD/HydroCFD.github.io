// Shared behaviour for every page: phone menu, reading progress, fade-in on scroll.
(function () {
  var nav = document.getElementById('nav');
  if (nav) {
    var toggle = nav.querySelector('.nav-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var open = nav.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? 'Close' : 'Menu';
      });
      nav.querySelectorAll('nav a').forEach(function (a) {
        a.addEventListener('click', function () {
          nav.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.textContent = 'Menu';
        });
      });
    }
    var bar = nav.querySelector('.nav-progress');
    var ticking = false;
    var update = function () {
      ticking = false;
      var root = document.documentElement;
      var max = root.scrollHeight - window.innerHeight;
      if (bar) bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, window.scrollY / max) : 0) + ')';
    };
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  var showAll = function () { reveals.forEach(function (el) { el.classList.add('in'); }); };

  // Arriving at an anchor (index.html#software, #contact): show everything at
  // once, and jump to the target again after fonts and images have settled,
  // because they change the height of the page above it.
  if (location.hash.length > 1) {
    showAll();
    var target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) {
      var jump = function () {
        var root = document.documentElement, old = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        target.scrollIntoView();
        root.style.scrollBehavior = old;
      };
      jump();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(jump);
      window.addEventListener('load', jump);
    }
  } else if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    showAll();
  }

  // a link to another section on the same page also shows all content
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href*="#"]');
    if (a && a.pathname === location.pathname) showAll();
  });
})();
