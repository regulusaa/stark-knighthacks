// Keep scene and navigation fixed; only the active right-hand panel scrolls.
export function mountWorkspaceTabs(root, { onSelect = () => {} } = {}) {
  const nav = document.createElement('div'); nav.className = 'workspace-tabs';
  nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'Controller workspace');
  nav.innerHTML = `<button id="modify-tab" role="tab" aria-controls="modify-workspace" data-workspace="modify">Surgery</button><button id="usage-tab" role="tab" aria-controls="usage-workspace" data-workspace="usage">Usage settings</button><button id="immersion-tab" role="tab" aria-controls="immersion-workspace" data-workspace="immersion">Immersion</button>`;
  const panels = {};
  for (const name of ['modify', 'usage', 'immersion']) {
    const panel = document.createElement('section'); panel.id = `${name}-workspace`; panel.className = 'workspace-content';
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `${name}-tab`); panels[name] = panel;
  }
  const move = (name, selectors) => selectors.forEach(selector => { const node = root.querySelector(selector); if (node) panels[name].append(node); });
  move('modify', ['.rotate-note', '.current-image', '#demo-rail', '#adversarial-pair', '#host-gallery', '#explore-tabs', '#steer-medical-note', '#steer-panel', '#answers-panel']);
  move('usage', ['#inspection-controls', '#host-slots', '#reset-view', '.sensitivity-control']);
  const tutorial = document.createElement('details'); tutorial.className = 'demo-tutorial';
  tutorial.innerHTML = `<summary>How to modify the model</summary><ol><li>Choose <strong>Tabby cat</strong> in the gallery (ask the host if you are a guest).</li><li>Take control, then open <strong>Steer</strong> above.</li><li>Set channel <strong>956</strong> to <strong>0</strong>. In Code, run <code>channel[956] = 0</code>.</li><li>Watch the answer change to <strong>tiger cat</strong> on the screen.</li><li>Tap <strong>Reset</strong> in Steer to restore the original model response.</li></ol><p>These edits change this image’s last-layer activations. They do not retrain the model.</p>`;
  panels.modify.append(tutorial);
  root.append(nav, panels.modify, panels.usage, panels.immersion);
  function select(name, focus = false) {
    if (!panels[name]) return;
    for (const [key, panel] of Object.entries(panels)) {
      const active = key === name; panel.hidden = !active;
      const button = nav.querySelector(`[data-workspace="${key}"]`);
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    }
    root.closest('.workbench').dataset.activeWorkspace = name;
    onSelect(name);
  }
  nav.addEventListener('click', e => { if (e.target.dataset.workspace) select(e.target.dataset.workspace); });
  nav.addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const names=Object.keys(panels),current=names.indexOf(nav.querySelector('[aria-selected="true"]').dataset.workspace); select(names[e.key==='Home'?0:e.key==='End'?2:(current+(e.key==='ArrowLeft'?2:1))%3],true); } });
  const requested=new URLSearchParams(location.search).get('workspace');
  select(requested in panels ? requested : 'modify');
  return { select, panels };
}
