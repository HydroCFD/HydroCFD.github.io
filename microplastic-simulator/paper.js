const film = document.querySelector('#film');
const captions = {
  '3d': '3D view. Suspended particles are coloured by effective density relative to water; settled particles are black. The vertical scale is enlarged 150 times.',
  plan: 'Plan view. Compare the downstream distribution of particles for transport alone, biofilm growth, fragmentation and both processes.',
  side: 'Side view. Compare vertical transport and deposition for transport alone, biofilm growth, fragmentation and both processes.'
};
document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-pressed') === 'true') return;
    film.pause();
    document.querySelectorAll('[data-view]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    const view = button.dataset.view;
    film.querySelector('source').src = `assets/meander_${view}.mp4`;
    film.setAttribute('aria-label', `Meandering river results: ${button.textContent}`);
    document.querySelector('#view-caption').textContent = captions[view];
    film.removeAttribute('poster');
    film.load();
  });
});
