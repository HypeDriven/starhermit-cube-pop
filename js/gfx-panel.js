/* Cube Pop — Graphics settings panel: GPU probe, localized strings and the
 * controls inside Settings → Graphics. The game ships English only; these
 * panel strings follow navigator.languages across the nine target locales.
 * Depends on window.CPGfx. Exposes window.CPGfxPanel.
 */
(function (root) {
  'use strict';
  var Gfx = root.CPGfx;

  var STRINGS = {
    'en-US': {
      title: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})', preset_low: 'Low', preset_balanced: 'Balanced',
      preset_high: 'High', preset_ultra: 'Ultra', render_scale: 'Render scale', from_preset: 'From preset ({tier})',
      shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Color grade', antialias: 'Anti-aliasing',
      reflections: 'Reflections', particles: 'Particles', background: 'Ambient motion', detail: 'Studio detail',
      tier_off: 'Off', tier_on: 'On', tier_low: 'Low', tier_medium: 'Medium', tier_high: 'High',
      tier_static: 'Still', tier_animated: 'Animated', tier_plain: 'Plain', tier_detailed: 'Detailed',
      adaptive: 'Adaptive resolution', show_fps: 'Show frame rate', unknown_gpu: 'Unknown GPU',
      no_effects: 'no effects', pending: 'resolution shown once the studio opens',
      post_note: 'Post-processing is unavailable on this device, so the studio renders without it.'
    },
    'en-GB': {
      grade: 'Colour grade', quality: 'Quality'
    },
    'es-419': {
      title: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})', preset_low: 'Baja', preset_balanced: 'Equilibrada',
      preset_high: 'Alta', preset_ultra: 'Ultra', render_scale: 'Escala de renderizado', from_preset: 'Del ajuste ({tier})',
      shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color', antialias: 'Antialiasing',
      reflections: 'Reflejos', particles: 'Partículas', background: 'Movimiento ambiental', detail: 'Detalle del estudio',
      tier_off: 'No', tier_on: 'Sí', tier_low: 'Bajo', tier_medium: 'Medio', tier_high: 'Alto',
      tier_static: 'Quieto', tier_animated: 'Animado', tier_plain: 'Simple', tier_detailed: 'Detallado',
      adaptive: 'Resolución adaptable', show_fps: 'Mostrar cuadros por segundo', unknown_gpu: 'GPU desconocida',
      no_effects: 'sin efectos', pending: 'la resolución aparece al abrir el estudio',
      post_note: 'El posprocesado no está disponible en este dispositivo; el estudio se dibuja sin él.'
    },
    'es-ES': {
      render_scale: 'Escala de renderizado', show_fps: 'Mostrar fotogramas por segundo',
      tier_off: 'Desactivado', tier_on: 'Activado'
    },
    'de-DE': {
      title: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})', preset_low: 'Niedrig', preset_balanced: 'Ausgewogen',
      preset_high: 'Hoch', preset_ultra: 'Ultra', render_scale: 'Renderskalierung', from_preset: 'Aus Voreinstellung ({tier})',
      shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Leuchten', grade: 'Farbkorrektur', antialias: 'Kantenglättung',
      reflections: 'Spiegelungen', particles: 'Partikel', background: 'Umgebungsbewegung', detail: 'Studio-Details',
      tier_off: 'Aus', tier_on: 'An', tier_low: 'Niedrig', tier_medium: 'Mittel', tier_high: 'Hoch',
      tier_static: 'Ruhig', tier_animated: 'Animiert', tier_plain: 'Schlicht', tier_detailed: 'Detailliert',
      adaptive: 'Adaptive Auflösung', show_fps: 'Bildrate anzeigen', unknown_gpu: 'Unbekannte GPU',
      no_effects: 'keine Effekte', pending: 'Auflösung erscheint, sobald das Studio geöffnet ist',
      post_note: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; das Studio wird ohne sie gezeichnet.'
    },
    'fr-FR': {
      title: 'Graphismes', quality: 'Qualité', auto: 'Auto (détectée : {tier})', preset_low: 'Basse', preset_balanced: 'Équilibrée',
      preset_high: 'Haute', preset_ultra: 'Ultra', render_scale: 'Échelle de rendu', from_preset: 'Selon le préréglage ({tier})',
      shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Lueur', grade: 'Étalonnage des couleurs', antialias: 'Anticrénelage',
      reflections: 'Reflets', particles: 'Particules', background: 'Mouvement ambiant', detail: 'Détails du studio',
      tier_off: 'Désactivé', tier_on: 'Activé', tier_low: 'Faible', tier_medium: 'Moyen', tier_high: 'Élevé',
      tier_static: 'Immobile', tier_animated: 'Animé', tier_plain: 'Simple', tier_detailed: 'Détaillé',
      adaptive: 'Résolution adaptative', show_fps: 'Afficher les images par seconde', unknown_gpu: 'GPU inconnu',
      no_effects: 'aucun effet', pending: 'la résolution s’affiche à l’ouverture du studio',
      post_note: 'Le post-traitement est indisponible sur cet appareil ; le studio s’affiche sans lui.'
    },
    'fr-CA': {
      antialias: 'Anticrénelage', bloom: 'Halo lumineux'
    },
    'pt-BR': {
      title: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})', preset_low: 'Baixa', preset_balanced: 'Equilibrada',
      preset_high: 'Alta', preset_ultra: 'Ultra', render_scale: 'Escala de renderização', from_preset: 'Da predefinição ({tier})',
      shadows: 'Sombras', ao: 'Oclusão de ambiente', bloom: 'Brilho', grade: 'Correção de cor', antialias: 'Antisserrilhamento',
      reflections: 'Reflexos', particles: 'Partículas', background: 'Movimento ambiente', detail: 'Detalhes do estúdio',
      tier_off: 'Desligado', tier_on: 'Ligado', tier_low: 'Baixo', tier_medium: 'Médio', tier_high: 'Alto',
      tier_static: 'Parado', tier_animated: 'Animado', tier_plain: 'Simples', tier_detailed: 'Detalhado',
      adaptive: 'Resolução adaptativa', show_fps: 'Mostrar taxa de quadros', unknown_gpu: 'GPU desconhecida',
      no_effects: 'sem efeitos', pending: 'a resolução aparece quando o estúdio abrir',
      post_note: 'O pós-processamento não está disponível neste aparelho; o estúdio é desenhado sem ele.'
    },
    'it-IT': {
      title: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})', preset_low: 'Bassa', preset_balanced: 'Bilanciata',
      preset_high: 'Alta', preset_ultra: 'Ultra', render_scale: 'Scala di rendering', from_preset: 'Dal preset ({tier})',
      shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore', antialias: 'Antialiasing',
      reflections: 'Riflessi', particles: 'Particelle', background: 'Movimento ambientale', detail: 'Dettagli dello studio',
      tier_off: 'No', tier_on: 'Sì', tier_low: 'Basso', tier_medium: 'Medio', tier_high: 'Alto',
      tier_static: 'Fermo', tier_animated: 'Animato', tier_plain: 'Semplice', tier_detailed: 'Dettagliato',
      adaptive: 'Risoluzione adattiva', show_fps: 'Mostra frame rate', unknown_gpu: 'GPU sconosciuta',
      no_effects: 'nessun effetto', pending: 'la risoluzione appare quando lo studio è aperto',
      post_note: 'La post-elaborazione non è disponibile su questo dispositivo; lo studio viene disegnato senza.'
    }
  };
  // Regional variants inherit from their base table.
  var BASE = { 'en-GB': 'en-US', 'es-ES': 'es-419', 'fr-CA': 'fr-FR' };
  var LOCALES = Object.keys(STRINGS);

  function pickLocale(langs) {
    var list = (langs && langs.length ? langs : ['en-US']).map(function (l) { return String(l); });
    for (var i = 0; i < list.length; i++) {
      var l = list[i].toLowerCase();
      for (var j = 0; j < LOCALES.length; j++) if (LOCALES[j].toLowerCase() === l) return LOCALES[j];
      var lang = l.split('-')[0];
      if (lang === 'en') return /-(gb|ie|au|nz|za|in)$/.test(l) ? 'en-GB' : 'en-US';
      if (lang === 'es') return l === 'es' || /-es$/.test(l) ? 'es-ES' : 'es-419';
      if (lang === 'fr') return /-ca$/.test(l) ? 'fr-CA' : 'fr-FR';
      if (lang === 'pt') return 'pt-BR';
      if (lang === 'de') return 'de-DE';
      if (lang === 'it') return 'it-IT';
    }
    return 'en-US';
  }

  var locale = 'en-US';
  function t(key, vars) {
    var table = STRINGS[locale], base = STRINGS[BASE[locale]] || {};
    var s = (table && table[key]) || base[key] || STRINGS['en-US'][key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }

  // Unmasked GPU name. Firefox exposes it through RENDERER directly (and warns
  // about the debug extension), Chrome only through WEBGL_debug_renderer_info.
  var probed = null;
  function probe() {
    if (probed) return probed;
    var gpu = '';
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl2') || c.getContext('webgl');
      if (gl) {
        gpu = String(gl.getParameter(gl.RENDERER) || '');
        if (!gpu || /^webkit webgl$/i.test(gpu) || /^mozilla$/i.test(gpu)) {
          var ext = gl.getExtension('WEBGL_debug_renderer_info');
          if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || gpu);
        }
      }
    } catch (e) { /* no WebGL: detection falls back to balanced */ }
    var mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && window.matchMedia && matchMedia('(pointer: coarse)').matches);
    probed = { gpu: gpu, detected: Gfx.detectPreset(gpu, mobile), mobile: mobile };
    return probed;
  }

  function $(id) { return document.getElementById(id); }
  function presetName(p) { return t('preset_' + p); }

  // Localized cost summary: "GPU · effects · W×H px".
  function summary(r, info, gpu) {
    var fx = [];
    if (r.shadows !== 'off') fx.push(t('shadows') + ' ' + Gfx.SHADOW_MAP[r.shadows] + '²');
    if (r.ao !== 'off') fx.push(t('ao') + (r.ao === 'high' ? ' +' : ''));
    if (r.bloom === 'on') fx.push(t('bloom'));
    if (r.reflections === 'on') fx.push(t('reflections'));
    if (r.antialias !== 'off') fx.push(r.antialias.toUpperCase());
    var parts = [gpu || t('unknown_gpu'), fx.length ? fx.join(', ') : t('no_effects')];
    parts.push(info && info.pixels && info.pixels[0] ? info.pixels[0] + '×' + info.pixels[1] + ' px' : t('pending'));
    if (info && info.fps && r.showFps) parts.push(info.fps + ' fps');
    return parts.join(' · ');
  }

  /**
   * Build/refresh the controls. `get()` returns the saved graphics object,
   * `set(obj)` stores it and applies it, `info()` returns renderer info or null.
   */
  function bind(get, set, info) {
    locale = pickLocale(navigator.languages || [navigator.language]);
    var p = probe();
    var box = $('gfx-settings');
    if (!box) return;
    box.setAttribute('lang', locale);
    box.querySelectorAll('[data-gfx-i18n]').forEach(function (n) { n.textContent = t(n.dataset.gfxI18n); });

    function resolved() { return Gfx.resolve(get(), p.detected); }

    var q = $('set-quality');
    q.innerHTML = '';
    [['auto', t('auto', { tier: presetName(p.detected) })]].concat(Gfx.PRESETS.map(function (k) { return [k, presetName(k)]; }))
      .forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o[0]; opt.textContent = o[1];
        q.appendChild(opt);
      });

    var cats = $('gfx-categories');
    cats.innerHTML = '';
    Object.keys(Gfx.CATEGORIES).forEach(function (cat) {
      var lab = document.createElement('label');
      var span = document.createElement('span');
      span.textContent = t(cat);
      var sel = document.createElement('select');
      sel.id = 'set-gfx-' + cat;
      sel.dataset.gfxCat = cat;
      lab.appendChild(span); lab.appendChild(document.createTextNode(' ')); lab.appendChild(sel);
      cats.appendChild(lab);
      sel.onchange = function () {
        var g = Object.assign({}, get());
        if (this.value === 'preset') delete g[cat]; else g[cat] = this.value;
        set(g); refresh();
      };
    });

    var scale = $('set-gfx-scale');
    q.onchange = function () { set(Gfx.choosePreset(get(), this.value)); refresh(); };
    scale.oninput = function () {
      var g = Object.assign({}, get());
      g.render_scale = (+this.value) / 100;
      set(g); refresh();
    };
    $('set-gfx-adaptive').onchange = function () {
      var g = Object.assign({}, get()); g.adaptive = this.checked; set(g); refresh();
    };
    $('set-gfx-fps').onchange = function () {
      var g = Object.assign({}, get()); g.show_fps = this.checked; set(g); refresh();
    };

    function refresh() {
      var g = get(), r = resolved();
      q.value = Gfx.PRESETS.indexOf(g.preset) >= 0 ? g.preset : 'auto';
      Object.keys(Gfx.CATEGORIES).forEach(function (cat) {
        var sel = $('set-gfx-' + cat);
        var from = Gfx.presetTier(r.preset, cat);
        sel.innerHTML = '';
        [['preset', t('from_preset', { tier: tierName(from) })]].concat(Gfx.CATEGORIES[cat].map(function (k) { return [k, tierName(k)]; }))
          .forEach(function (o) {
            var opt = document.createElement('option');
            opt.value = o[0]; opt.textContent = o[1];
            sel.appendChild(opt);
          });
        sel.value = Gfx.CATEGORIES[cat].indexOf(g[cat]) >= 0 ? g[cat] : 'preset';
      });
      scale.value = Math.round(r.renderScale * 100);
      $('gfx-scale-val').textContent = Math.round(r.renderScale * 100) + '%';
      $('set-gfx-adaptive').checked = r.adaptive;
      $('set-gfx-fps').checked = r.showFps;
      refreshSummary();
    }
    // Summary + post note only (safe to call on a timer while a select is open).
    function refreshSummary() {
      var i = info();
      $('gfx-summary').textContent = summary(resolved(), i, p.gpu);
      $('gfx-post-note').hidden = !(i && i.postFailed);
    }
    refresh();
    return refreshSummary;
  }

  function tierName(k) {
    return /^(fxaa|smaa|msaa)$/.test(k) ? k.toUpperCase() : t('tier_' + k);
  }

  root.CPGfxPanel = { bind: bind, probe: probe, pickLocale: pickLocale, t: t, STRINGS: STRINGS };
})(typeof self !== 'undefined' ? self : this);
