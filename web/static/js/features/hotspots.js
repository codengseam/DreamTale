/**
 * DreamTale · 热点页面功能模块（IIFE 经典脚本）
 *
 * 功能：
 * - 平台标签栏：全部 / 知乎 / 微博 / 抖音 / 番茄 / 小红书
 * - 热点列表：标题 / 热度 / 平台 / 摘要 / 标签 / 跳转链接 / 收藏到灵感库按钮
 * - 搜索框：关键词检索
 * - 题材筛选：基于当前项目的 genre 标签自动筛选
 * - 刷新按钮 + 缓存时间显示
 *
 * 通过 window.DreamTaleFeatures.renderHotspots(container) 挂载。
 *
 * 依赖：
 *   - window.DreamTale.state / notify / modules（懒加载 extension 模块）
 *   - 动态 import('../../src/extension/hotspot-aggregator.js')
 *   - 动态 import('../../src/extension/genre-matcher.js')
 *   - 动态 import('../../src/extension/inspiration-library.js')
 */
(function (global) {
  'use strict';

  const NS = (global.DreamTaleFeatures = global.DreamTaleFeatures || {});

  // ---------- 工具 ----------

  function DT() {
    if (!global.DreamTale) throw new Error('[hotspots] window.DreamTale 未初始化');
    return global.DreamTale;
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 格式化时间：YYYY-MM-DD HH:mm */
  function fmtTime(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 平台中文名 */
  const PLATFORM_LABELS = {
    zhihu: '知乎',
    weibo: '微博',
    douyin: '抖音',
    fanqie: '番茄',
    xiaohongshu: '小红书',
  };

  /** 全部内置平台 */
  const ALL_PLATFORMS = ['zhihu', 'weibo', 'douyin', 'fanqie', 'xiaohongshu'];

  // 懒加载的 ES Module
  let _extModules = null;
  async function loadExt() {
    if (_extModules) return _extModules;
    const [agg, matcher, lib] = await Promise.all([
      import('../../src/extension/hotspot-aggregator.js'),
      import('../../src/extension/genre-matcher.js'),
      import('../../src/extension/inspiration-library.js'),
    ]);
    _extModules = { aggregator: agg, matcher, library: lib };
    return _extModules;
  }

  /** 通用模态框 */
  function createModal(opts) {
    const overlay = document.createElement('div');
    overlay.className = 'dt-modal-overlay';
    overlay.innerHTML = `
      <div class="dt-modal">
        <div class="dt-modal-header">
          <h3>${esc(opts.title || '')}</h3>
          <button class="dt-modal-close" data-act="close" aria-label="关闭">×</button>
        </div>
        <div class="dt-modal-body">${opts.bodyHTML || ''}</div>
        <div class="dt-modal-footer">
          <button class="dt-btn" data-act="cancel">取消</button>
          <button class="dt-btn ${opts.submitClass || 'dt-btn-primary'}" data-act="submit">${esc(opts.submitText || '确定')}</button>
        </div>
      </div>`;
    const body = overlay.querySelector('.dt-modal-body');
    const close = () => overlay.remove();
    overlay.querySelector('[data-act="close"]').addEventListener('click', close);
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const submitBtn = overlay.querySelector('[data-act="submit"]');
    submitBtn.addEventListener('click', async () => {
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      submitBtn.textContent = '处理中…';
      try {
        const ok = await opts.onSubmit(body, close);
        if (ok !== false) close();
      } catch (err) {
        console.error('[hotspots] 模态框提交异常:', err);
        DT().notify('操作失败：' + (err.message || err), 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = opts.submitText || '确定';
      }
    });
    return overlay;
  }

  // ---------- 主渲染入口 ----------

  async function renderHotspots(container) {
    if (!container) throw new Error('[hotspots] container 不能为空');
    container.innerHTML = '';

    // 顶部工具栏
    const toolbar = document.createElement('div');
    toolbar.className = 'dt-toolbar';
    toolbar.innerHTML = `
      <h2 class="dt-page-title">🔥 热点采集</h2>
      <div class="dt-toolbar-actions">
        <input type="text" class="dt-input" data-act="keyword" placeholder="关键词检索…" style="min-width:200px;" />
        <button class="dt-btn" data-act="refresh">刷新</button>
      </div>
    `;
    container.appendChild(toolbar);

    // 平台标签栏
    const filterBar = document.createElement('div');
    filterBar.className = 'dt-filter-bar';
    const platformBtns = ['all', ...ALL_PLATFORMS].map((p) => {
      const label = p === 'all' ? '全部' : (PLATFORM_LABELS[p] || p);
      return `<button class="dt-btn dt-btn-sm dt-filter-btn ${p === 'all' ? 'active' : ''}" data-platform="${p}">${esc(label)}</button>`;
    }).join('');
    filterBar.innerHTML = `<span class="dt-filter-label">平台：</span>${platformBtns}`;

    // 题材筛选栏
    const genreBar = document.createElement('div');
    genreBar.className = 'dt-filter-bar';
    genreBar.innerHTML = `<span class="dt-filter-label">题材筛选：</span>
      <select class="dt-input" data-act="genre" style="min-width:120px;">
        <option value="">不筛选</option>
      </select>
      <label class="dt-checkbox"><input type="checkbox" data-act="only-matched" /> 仅显示匹配</label>`;

    // 缓存时间显示
    const cacheBar = document.createElement('div');
    cacheBar.className = 'dt-cache-bar';
    cacheBar.innerHTML = '<span class="dt-cache-text">缓存：未加载</span>';

    // 列表容器
    const listWrap = document.createElement('div');
    listWrap.className = 'dt-hotspot-list';
    listWrap.innerHTML = '<p class="dt-empty-hint">加载中…</p>';

    container.appendChild(filterBar);
    container.appendChild(genreBar);
    container.appendChild(cacheBar);
    container.appendChild(listWrap);

    // ---------- 状态 ----------
    let state = {
      platform: 'all',
      genre: '',
      onlyMatched: false,
      keyword: '',
      hotspots: [], // 当前已加载的全部热点
    };

    // ---------- 加载 extension 模块 ----------
    let aggInstance = null;
    let matcherMod = null;
    let libInstance = null;
    try {
      const ext = await loadExt();
      aggInstance = new ext.aggregator.HotspotAggregator();
      matcherMod = ext.matcher;
      libInstance = new ext.library.InspirationLibrary();
    } catch (err) {
      console.error('[hotspots] 模块加载失败:', err);
      listWrap.innerHTML = `<p class="dt-empty-hint dt-error">扩展模块加载失败：${esc(err.message || err)}</p>`;
      return;
    }

    // 填充题材下拉（基于当前项目 genre + 内置题材列表）
    function fillGenreSelect() {
      const sel = genreBar.querySelector('[data-act="genre"]');
      const cur = state.genre;
      const genres = matcherMod.listGenres();
      // 把当前项目的 genre 排在最前
      const proj = DT().state.currentProject;
      const projGenre = proj && proj.genre ? proj.genre : '';
      let html = '<option value="">不筛选</option>';
      if (projGenre && genres.includes(projGenre)) {
        html += `<option value="${esc(projGenre)}">${esc(projGenre)}（当前作品）</option>`;
      }
      for (const g of genres) {
        if (g === projGenre) continue;
        html += `<option value="${esc(g)}">${esc(g)}</option>`;
      }
      sel.innerHTML = html;
      sel.value = cur;
    }
    fillGenreSelect();

    // ---------- 事件绑定 ----------
    filterBar.querySelectorAll('[data-platform]').forEach((btn) => {
      btn.addEventListener('click', () => {
        filterBar.querySelectorAll('[data-platform]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.platform = btn.getAttribute('data-platform');
        renderList();
      });
    });

    genreBar.querySelector('[data-act="genre"]').addEventListener('change', (e) => {
      state.genre = e.target.value;
      renderList();
    });

    genreBar.querySelector('[data-act="only-matched"]').addEventListener('change', (e) => {
      state.onlyMatched = e.target.checked;
      renderList();
    });

    const kwInput = toolbar.querySelector('[data-act="keyword"]');
    let kwTimer = null;
    kwInput.addEventListener('input', (e) => {
      clearTimeout(kwTimer);
      kwTimer = setTimeout(() => {
        state.keyword = e.target.value.trim();
        renderList();
      }, 250);
    });

    toolbar.querySelector('[data-act="refresh"]').addEventListener('click', async () => {
      await loadHotspots(true);
    });

    // ---------- 加载热点 ----------
    async function loadHotspots(forceRefresh) {
      listWrap.innerHTML = '<p class="dt-empty-hint">正在抓取热点…</p>';
      if (forceRefresh) aggInstance.clearCache();
      try {
        const platforms = state.platform === 'all' ? ALL_PLATFORMS : [state.platform];
        // fetchByKeyword 返回的是按关键词过滤后的；缺省无关键词则返回全部
        let data;
        if (state.keyword) {
          data = await aggInstance.fetchByKeyword(state.keyword, platforms);
        } else {
          data = await aggInstance.fetchHotspots(platforms, 30);
        }
        // 给热点打题材标签
        matcherMod.tagHotspots(data);
        state.hotspots = data;
        renderList();
        renderCacheBar();
      } catch (err) {
        console.error('[hotspots] 加载失败:', err);
        listWrap.innerHTML = `<p class="dt-empty-hint dt-error">加载失败：${esc(err.message || err)}</p>`;
        DT().notify('热点加载失败：' + (err.message || err), 'error');
      }
    }

    function renderCacheBar() {
      const el = cacheBar.querySelector('.dt-cache-text');
      const platforms = state.platform === 'all' ? ALL_PLATFORMS : [state.platform];
      const times = platforms.map((p) => aggInstance.getCacheTime(p)).filter(Boolean);
      if (times.length === 0) {
        el.textContent = '缓存：无';
      } else {
        const earliest = times.sort()[0];
        el.textContent = '缓存时间：' + fmtTime(earliest);
      }
    }

    // ---------- 渲染列表 ----------
    function renderList() {
      let list = state.hotspots.slice();
      // 平台筛选
      if (state.platform !== 'all') {
        list = list.filter((h) => h.platform === state.platform);
      }
      // 关键词筛选（已由 fetchByKeyword 处理，但也兜底本地过滤）
      if (state.keyword) {
        const kw = state.keyword.toLowerCase();
        list = list.filter((h) => (h.title || '').toLowerCase().includes(kw) || (h.summary || '').toLowerCase().includes(kw));
      }
      // 题材筛选
      if (state.genre) {
        const genre = state.genre;
        if (state.onlyMatched) {
          list = matcherMod.matchByGenre(list, genre, { threshold: 0.05 });
        } else {
          // 不强制过滤，只附加 _score
          list = list.map((h) => ({ ...h, _score: matcherMod.scoreHotspot(h, genre) }));
          list.sort((a, b) => (b._score || 0) - (a._score || 0));
        }
      } else {
        list.sort((a, b) => (b.heat || 0) - (a.heat || 0));
      }

      if (list.length === 0) {
        listWrap.innerHTML = `
          <div class="dt-empty-state">
            <p>暂无热点，点击「刷新」重新抓取。</p>
          </div>`;
        return;
      }

      listWrap.innerHTML = `<div class="dt-cards">${list.map(hotspotCardHTML).join('')}</div>`;

      // 绑定收藏按钮
      listWrap.querySelectorAll('[data-act="fav"]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = Number(btn.getAttribute('data-idx'));
          const h = list[idx];
          if (h) openFavoriteModal(h);
        });
      });
    }

    function hotspotCardHTML(h, idx) {
      const platformLabel = PLATFORM_LABELS[h.platform] || h.platform;
      const tags = (h.genreTags || []).map((t) => `<span class="dt-tag">${esc(t)}</span>`).join('');
      const score = typeof h._score === 'number' ? `<span class="dt-tag dt-tag-score">匹配 ${(h._score * 100).toFixed(0)}%</span>` : '';
      const link = h.sourceUrl ? `<a class="dt-link" href="${esc(h.sourceUrl)}" target="_blank" rel="noopener">原文 ↗</a>` : '';
      return `
        <div class="dt-card dt-hotspot-card">
          <div class="dt-card-header">
            <h3 class="dt-card-title">${esc(h.title || '无标题')}</h3>
            <span class="dt-tag dt-tag-platform">${esc(platformLabel)}</span>
          </div>
          <div class="dt-card-meta">
            <span>🔥 热度 ${esc(h.heat || 0)}</span>
            ${score}
            ${tags}
          </div>
          ${h.summary ? `<p class="dt-card-summary">${esc(h.summary)}</p>` : ''}
          <div class="dt-card-footer">
            <span class="dt-time">抓取：${esc(fmtTime(h.fetchedAt))}</span>
            <div class="dt-card-actions">
              ${link}
              <button class="dt-btn dt-btn-sm dt-btn-primary" data-act="fav" data-idx="${idx}">收藏到灵感库</button>
            </div>
          </div>
        </div>`;
    }

    // ---------- 收藏到灵感库模态框 ----------
    function openFavoriteModal(hotspot) {
      const overlay = createModal({
        title: '收藏到灵感库',
        bodyHTML: `
          <div class="dt-form">
            <div class="dt-form-row">
              <label>类型 <span class="dt-req">*</span></label>
              <select data-field="type">
                <option value="idea">灵感</option>
                <option value="snippet">片段</option>
                <option value="material">素材</option>
                <option value="highlight">爽点</option>
                <option value="character">人物</option>
                <option value="worldview">世界观</option>
                <option value="golden_finger">金手指</option>
                <option value="voice">语音转录</option>
              </select>
            </div>
            <div class="dt-form-row">
              <label>标题 <span class="dt-req">*</span></label>
              <input type="text" data-field="title" value="${esc(hotspot.title || '')}" />
            </div>
            <div class="dt-form-row">
              <label>内容（Markdown）</label>
              <textarea data-field="content" rows="6">${esc(hotspot.summary || '')}</textarea>
            </div>
            <div class="dt-form-row">
              <label>标签（逗号分隔）</label>
              <input type="text" data-field="tags" value="${esc((hotspot.genreTags || []).join(', '))}" />
            </div>
            <div class="dt-form-row">
              <label>来源链接</label>
              <input type="text" data-field="sourceUrl" value="${esc(hotspot.sourceUrl || '')}" />
            </div>
          </div>`,
        submitText: '收藏',
        onSubmit: async (formEl) => {
          const type = formEl.querySelector('[data-field="type"]').value;
          const title = formEl.querySelector('[data-field="title"]').value.trim();
          if (!title) {
            DT().notify('标题不能为空', 'warning');
            return false;
          }
          const content = formEl.querySelector('[data-field="content"]').value;
          const tagsStr = formEl.querySelector('[data-field="tags"]').value;
          const tags = tagsStr ? tagsStr.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
          const sourceUrl = formEl.querySelector('[data-field="sourceUrl"]').value.trim();
          try {
            await libInstance.addInspiration({ type, title, content, tags, sourceUrl });
            DT().notify('已收藏到灵感库', 'success');
            return true;
          } catch (err) {
            console.error('[hotspots] 收藏失败:', err);
            DT().notify('收藏失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      container.appendChild(overlay);
    }

    // ---------- 首次加载 ----------
    await loadHotspots(false);
  }

  NS.renderHotspots = renderHotspots;
})(window);
