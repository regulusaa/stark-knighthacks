function thumbnailPath(image) {
  const folder = String(image.folder || '').replace(/^\/+/, '');
  return `/${folder}crop.png`;
}

function placeholder() {
  const fallback = document.createElement('span');
  fallback.className = 'gallery-placeholder';
  const caption = document.createElement('small');
  caption.textContent = 'No thumbnail';
  fallback.append(caption);
  return fallback;
}

export function createGallery({ root, mock, onSelect, onTimeout }) {
  const tiles = new Map();
  let currentId = null;
  let pendingId = null;
  let pendingTimer = 0;
  let signature = '';

  function paint() {
    for (const [id, tile] of tiles) {
      const pending = id === pendingId;
      const current = id === currentId;
      tile.classList.toggle('pending', pending);
      tile.classList.toggle('current', current);
      tile.setAttribute('aria-busy', String(pending));
      tile.setAttribute('aria-current', current ? 'true' : 'false');
    }
  }

  function clearPending() {
    clearTimeout(pendingTimer);
    pendingTimer = 0;
    pendingId = null;
    paint();
  }

  function makeTile(image) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'gallery-tile';
    tile.dataset.imageId = image.id;
    tile.setAttribute('aria-label', `${image.name}, ${image.category}`);
    const thumb = document.createElement('span');
    thumb.className = 'gallery-thumb';
    if (mock || !image.files?.crop) {
      thumb.append(placeholder());
    } else {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = thumbnailPath(image);
      img.addEventListener('error', () => { img.replaceWith(placeholder()); }, { once: true });
      thumb.append(img);
    }
    const copy = document.createElement('span');
    copy.className = 'gallery-tile-copy';
    const name = document.createElement('span');
    name.className = 'gallery-name';
    name.textContent = image.name;
    const category = document.createElement('span');
    category.className = 'category-chip';
    category.dataset.category = image.category;
    category.textContent = image.category;
    const pending = document.createElement('span');
    pending.className = 'tile-pending';
    pending.textContent = 'Loading…';
    copy.append(name, category, pending);
    tile.append(thumb, copy);

    let startX = 0;
    let startY = 0;
    let moved = false;
    tile.addEventListener('pointerdown', event => { startX = event.clientX; startY = event.clientY; moved = false; });
    tile.addEventListener('pointermove', event => {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 8) moved = true;
    });
    tile.addEventListener('pointercancel', () => { moved = true; });
    tile.addEventListener('click', event => {
      if (moved || pendingId || image.id === currentId) { event.preventDefault(); moved = false; return; }
      pendingId = image.id;
      paint();
      pendingTimer = setTimeout(() => { clearPending(); onTimeout(); }, 8000);
      onSelect(image.id);
    });
    return tile;
  }

  function setManifest(manifest) {
    const images = Array.isArray(manifest?.images) ? [...manifest.images].sort((a, b) => a.order - b.order) : [];
    const nextSignature = JSON.stringify(images.map(({ id, name, category, order, folder, files }) => [id, name, category, order, folder, files?.crop]));
    if (signature === nextSignature) return;
    signature = nextSignature;
    tiles.clear();
    const fragment = document.createDocumentFragment();
    for (const image of images) {
      const tile = makeTile(image);
      tiles.set(image.id, tile);
      fragment.append(tile);
    }
    root.replaceChildren(fragment);
    paint();
  }

  function setCurrent(id) {
    const changed = currentId !== id;
    currentId = id;
    if (pendingId && (pendingId === id || changed)) clearPending();
    else paint();
  }

  return { setManifest, setCurrent, clearPending, destroy() { clearPending(); root.replaceChildren(); } };
}
