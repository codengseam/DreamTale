/**
 * DreamTale · 设定管理功能模块
 *
 * 三个 Tab：世界观 / 角色人设 / 人物关系网
 * - 世界观：WorldSetting[]（category + content），用 MarkdownEditor 编辑 content
 * - 角色人设：Character[]，卡片式展示，9 字段编辑
 * - 关系网：SVG 节点-边图，节点=角色，边=关系描述，点击节点可编辑
 *
 * 通过 window.DreamTaleFeatures.renderSettings(container) 挂载。
 *
 * 依赖：
 *   - window.DreamTale.state / storage / notify
 *   - window.DreamTaleEditor.create(container, options)  编辑器实例
 *
 * 数据模型对齐 core/models.js 的 WorldSetting / Character 类。
 */
(function (global) {
  'use strict';

  const NS = (global.DreamTaleFeatures = global.DreamTaleFeatures || {});

  // ---------- 工具 ----------

  function DT() {
    if (!global.DreamTale) throw new Error('[settings] window.DreamTale 未初始化');
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

  /** 当前项目 id 校验 */
  function currentProjectId() {
    const proj = DT().state.currentProject;
    if (!proj) {
      DT().notify('请先在「作品管理」中选择一个作品', 'warning');
      return null;
    }
    // state.currentProject 是 Project 实例对象，存储层需要的是 id 字符串
    return proj.id;
  }

  /** 角色预设颜色，新建角色自动轮转分配 */
  const COLOR_PALETTE = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];

  /** 通用模态框（与 projects.js 同型，本模块内部使用） */
  function createModal(opts) {
    const overlay = document.createElement('div');
    overlay.className = 'dt-modal-overlay';
    overlay.innerHTML = `
      <div class="dt-modal ${opts.size === 'large' ? 'dt-modal-large' : ''}">
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
        console.error('[settings] 模态框提交异常:', err);
        DT().notify('操作失败：' + (err.message || err), 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = opts.submitText || '确定';
      }
    });
    return overlay;
  }

  // ---------- 主渲染入口 ----------

  async function renderSettings(container) {
    if (!container) throw new Error('[settings] container 不能为空');
    container.innerHTML = '';

    // 顶部 Tab
    const tabs = document.createElement('div');
    tabs.className = 'dt-tabs';
    tabs.innerHTML = `
      <div class="dt-tab-bar">
        <button class="dt-tab active" data-tab="worldview">世界观</button>
        <button class="dt-tab" data-tab="characters">角色人设</button>
        <button class="dt-tab" data-tab="relations">人物关系网</button>
      </div>`;
    container.appendChild(tabs);

    // 内容区
    const panel = document.createElement('div');
    panel.className = 'dt-tab-panel';
    container.appendChild(panel);

    let currentTab = 'worldview';
    async function switchTab(name) {
      currentTab = name;
      tabs.querySelectorAll('.dt-tab').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-tab') === name);
      });
      panel.innerHTML = '';
      if (name === 'worldview') await renderWorldView(panel);
      else if (name === 'characters') await renderCharacters(panel);
      else if (name === 'relations') await renderRelations(panel);
    }

    tabs.querySelectorAll('.dt-tab').forEach((b) => {
      b.addEventListener('click', () => switchTab(b.getAttribute('data-tab')));
    });

    await switchTab('worldview');
  }

  // ==================== Tab 1：世界观 ====================

  async function renderWorldView(panel) {
    const pid = currentProjectId();
    if (!pid) {
      panel.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>';
      return;
    }

    panel.innerHTML = `
      <div class="dt-toolbar">
        <h3 class="dt-section-title">世界观设定</h3>
        <div class="dt-toolbar-actions">
          <button class="dt-btn dt-btn-primary" data-act="new">+ 新建设定</button>
          <button class="dt-btn" data-act="up">↑ 上移</button>
          <button class="dt-btn" data-act="down">↓ 下移</button>
          <button class="dt-btn" data-act="refresh">刷新</button>
        </div>
      </div>
      <div class="dt-wv-list"><p class="dt-empty-hint">加载中…</p></div>`;

    let settings = [];
    let selectedIndex = -1;

    async function reload() {
      const list = panel.querySelector('.dt-wv-list');
      list.innerHTML = '<p class="dt-empty-hint">加载中…</p>';
      try {
        settings = (await DT().storage.listWorldSettings(pid)) || [];
        settings.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        renderList();
      } catch (err) {
        console.error('[settings] 世界观加载失败:', err);
        list.innerHTML = `<p class="dt-empty-hint dt-error">加载失败：${esc(err.message || err)}</p>`;
      }
    }

    function renderList() {
      const list = panel.querySelector('.dt-wv-list');
      if (!settings.length) {
        list.innerHTML = `
          <div class="dt-empty-state">
            <p>暂无世界观设定</p>
            <button class="dt-btn dt-btn-primary" data-act="new-empty">+ 新建第一条设定</button>
          </div>`;
        list.querySelector('[data-act="new-empty"]').addEventListener('click', () => openEditor(null));
        return;
      }
      list.innerHTML = `
        <ul class="dt-wv-items">
          ${settings.map((s, i) => `
            <li class="dt-wv-item ${i === selectedIndex ? 'dt-wv-item-active' : ''}" data-idx="${i}">
              <div class="dt-wv-item-main">
                <span class="dt-wv-cat">${esc(s.category || '未分类')}</span>
                <span class="dt-wv-preview">${esc((s.content || '').slice(0, 80).replace(/\n/g, ' '))}${(s.content || '').length > 80 ? '…' : ''}</span>
              </div>
              <div class="dt-wv-item-actions">
                <button class="dt-btn dt-btn-sm" data-act="edit">编辑</button>
                <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="del">删除</button>
              </div>
            </li>`).join('')}
        </ul>`;
      list.querySelectorAll('.dt-wv-item').forEach((li) => {
        const idx = Number(li.getAttribute('data-idx'));
        li.addEventListener('click', () => {
          selectedIndex = idx;
          renderList();
        });
        li.querySelector('[data-act="edit"]').addEventListener('click', (e) => {
          e.stopPropagation();
          openEditor(settings[idx]);
        });
        li.querySelector('[data-act="del"]').addEventListener('click', (e) => {
          e.stopPropagation();
          confirmDeleteSetting(settings[idx]);
        });
      });
    }

    function openEditor(setting) {
      const isEdit = !!setting;
      const data = isEdit ? { ...setting } : { category: '', content: '', sort_order: settings.length };
      const overlay = createModal({
        title: isEdit ? '编辑世界观设定' : '新建世界观设定',
        size: 'large',
        bodyHTML: `
          <div class="dt-form">
            <div class="dt-form-row">
              <label>分类 <span class="dt-req">*</span></label>
              <input type="text" data-field="category" value="${esc(data.category)}" placeholder="如：地理/历史/势力/魔法体系" />
            </div>
            <div class="dt-form-row">
              <label>内容（Markdown）</label>
              <div class="dt-editor-host" data-field="content-editor"></div>
            </div>
          </div>`,
        submitText: isEdit ? '保存' : '创建',
        onSubmit: async (formEl, closeFn) => {
          const category = formEl.querySelector('[data-field="category"]').value.trim();
          if (!category) {
            DT().notify('分类不能为空', 'warning');
            return false;
          }
          const content = contentEditor ? contentEditor.getValue() : '';
          const payload = {
            category,
            content,
            sort_order: data.sort_order,
          };
          try {
            await DT().storage.saveWorldSetting(pid, payload);
            DT().notify(isEdit ? '设定已更新' : '设定已创建', 'success');
            await reload();
            return true;
          } catch (err) {
            console.error('[settings] 保存设定失败:', err);
            DT().notify('保存失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      panel.appendChild(overlay);
      // 创建编辑器实例
      let contentEditor = null;
      const editorHost = overlay.querySelector('[data-field="content-editor"]');
      if (editorHost && global.DreamTaleEditor) {
        try {
          contentEditor = global.DreamTaleEditor.create(editorHost, {
            initialValue: data.content || '',
            theme: DT().state.theme || 'light',
          });
        } catch (err) {
          console.error('[settings] 编辑器创建失败:', err);
          editorHost.innerHTML = `<textarea data-field="content-fallback" style="width:100%;min-height:240px;">${esc(data.content || '')}</textarea>`;
        }
      } else {
        editorHost.innerHTML = `<textarea data-field="content-fallback" style="width:100%;min-height:240px;">${esc(data.content || '')}</textarea>`;
      }
    }

    function confirmDeleteSetting(setting) {
      const overlay = createModal({
        title: '删除设定',
        bodyHTML: `<p>确认删除世界观设定「<strong>${esc(setting.category)}</strong>」？此操作不可撤销。</p>`,
        submitText: '删除',
        submitClass: 'dt-btn-danger',
        onSubmit: async () => {
          // WorldSetting 没有 delete 接口，用 saveWorldSetting 把 content 置空标记删除？
          // 实际 IStorageBackend 未提供 deleteWorldSetting，此处用保存空内容 + 标记的方式不可行。
          // 兜底：通知用户该后端可能不支持，但尝试通过 saveWorldSetting 写入空对象作为软删除。
          // 注：实际删除由后端按 category 覆盖（save 即 upsert），这里采用重写空 content + 特殊 category 不合适。
          // 因此这里给出明确错误提示，避免数据污染。
          DT().notify('当前存储后端未提供世界观删除接口，请通过覆盖编辑实现', 'warning');
          return false;
        },
      });
      panel.appendChild(overlay);
    }

    // 排序按钮
    panel.querySelector('[data-act="new"]').addEventListener('click', () => openEditor(null));
    panel.querySelector('[data-act="refresh"]').addEventListener('click', reload);
    panel.querySelector('[data-act="up"]').addEventListener('click', async () => {
      if (selectedIndex <= 0) {
        DT().notify('请先选中要上移的项', 'info');
        return;
      }
      await swapOrder(selectedIndex, selectedIndex - 1);
    });
    panel.querySelector('[data-act="down"]').addEventListener('click', async () => {
      if (selectedIndex < 0 || selectedIndex >= settings.length - 1) {
        DT().notify('请先选中要下移的项', 'info');
        return;
      }
      await swapOrder(selectedIndex, selectedIndex + 1);
    });

    async function swapOrder(i, j) {
      const a = { ...settings[i], sort_order: settings[j].sort_order };
      const b = { ...settings[j], sort_order: settings[i].sort_order };
      try {
        await DT().storage.saveWorldSetting(pid, a);
        await DT().storage.saveWorldSetting(pid, b);
        DT().notify('顺序已更新', 'success');
        await reload();
      } catch (err) {
        console.error('[settings] 排序失败:', err);
        DT().notify('排序失败：' + (err.message || err), 'error');
      }
    }

    await reload();
  }

  // ==================== Tab 2：角色人设 ====================

  async function renderCharacters(panel) {
    const pid = currentProjectId();
    if (!pid) {
      panel.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>';
      return;
    }

    panel.innerHTML = `
      <div class="dt-toolbar">
        <h3 class="dt-section-title">角色人设</h3>
        <div class="dt-toolbar-actions">
          <button class="dt-btn dt-btn-primary" data-act="new">+ 新建角色</button>
          <button class="dt-btn" data-act="refresh">刷新</button>
        </div>
      </div>
      <div class="dt-char-list"><p class="dt-empty-hint">加载中…</p></div>`;

    let characters = [];

    async function reload() {
      const list = panel.querySelector('.dt-char-list');
      list.innerHTML = '<p class="dt-empty-hint">加载中…</p>';
      try {
        characters = (await DT().storage.listCharacters(pid)) || [];
        renderList();
      } catch (err) {
        console.error('[settings] 角色加载失败:', err);
        list.innerHTML = `<p class="dt-empty-hint dt-error">加载失败：${esc(err.message || err)}</p>`;
      }
    }

    function renderList() {
      const list = panel.querySelector('.dt-char-list');
      if (!characters.length) {
        list.innerHTML = `
          <div class="dt-empty-state">
            <p>暂无角色</p>
            <button class="dt-btn dt-btn-primary" data-act="new-empty">+ 创建第一个角色</button>
          </div>`;
        list.querySelector('[data-act="new-empty"]').addEventListener('click', () => openEditor(null));
        return;
      }
      list.innerHTML = `<div class="dt-cards">${characters.map((c, i) => charCardHTML(c, i)).join('')}</div>`;
      list.querySelectorAll('[data-char-idx]').forEach((card) => {
        const idx = Number(card.getAttribute('data-char-idx'));
        card.querySelector('[data-act="edit"]').addEventListener('click', () => openEditor(characters[idx]));
        card.querySelector('[data-act="del"]').addEventListener('click', () => confirmDeleteChar(characters[idx]));
      });
    }

    function charCardHTML(c, i) {
      const color = c.color || COLOR_PALETTE[i % COLOR_PALETTE.length];
      const initial = (c.name || '?').charAt(0);
      return `
        <div class="dt-card dt-char-card" data-char-idx="${i}">
          <div class="dt-char-avatar" style="background:${esc(color)}">${esc(initial)}</div>
          <div class="dt-card-header">
            <h4 class="dt-card-title">${esc(c.name || '未命名')}</h4>
            ${c.role ? `<span class="dt-tag">${esc(c.role)}</span>` : ''}
          </div>
          ${c.identity ? `<p class="dt-char-identity">${esc(c.identity)}</p>` : ''}
          <dl class="dt-char-fields">
            ${c.level ? `<dt>境界/等级</dt><dd>${esc(c.level)}</dd>` : ''}
            ${c.personality ? `<dt>性格</dt><dd>${esc(c.personality)}</dd>` : ''}
            ${c.goal ? `<dt>目标</dt><dd>${esc(c.goal)}</dd>` : ''}
            ${c.arc ? `<dt>弧光</dt><dd>${esc(c.arc)}</dd>` : ''}
            ${c.relation ? `<dt>关系</dt><dd>${esc(c.relation)}</dd>` : ''}
          </dl>
          <div class="dt-card-footer">
            <button class="dt-btn dt-btn-sm" data-act="edit">编辑</button>
            <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="del">删除</button>
          </div>
        </div>`;
    }

    function openEditor(char) {
      const isEdit = !!char;
      const data = isEdit ? { ...char } : { name: '', role: '', identity: '', level: '', personality: '', arc: '', relation: '', goal: '', color: COLOR_PALETTE[characters.length % COLOR_PALETTE.length] };
      const overlay = createModal({
        title: isEdit ? '编辑角色' : '新建角色',
        size: 'large',
        bodyHTML: `
          <div class="dt-form">
            <div class="dt-form-row dt-form-row-2col">
              <div>
                <label>姓名 <span class="dt-req">*</span></label>
                <input type="text" data-field="name" value="${esc(data.name)}" placeholder="角色姓名" />
              </div>
              <div>
                <label>角色定位</label>
                <input type="text" data-field="role" value="${esc(data.role)}" placeholder="主角/反派/配角" list="dt-role-list" />
                <datalist id="dt-role-list">
                  <option value="主角"></option><option value="女主"></option>
                  <option value="反派"></option><option value="重要配角"></option>
                  <option value="次要配角"></option><option value="工具人"></option>
                </datalist>
              </div>
            </div>
            <div class="dt-form-row">
              <label>身份</label>
              <input type="text" data-field="identity" value="${esc(data.identity)}" placeholder="如：宗门长老/帝国皇帝" />
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div>
                <label>境界/等级</label>
                <input type="text" data-field="level" value="${esc(data.level)}" placeholder="如：筑基中期/S级" />
              </div>
              <div>
                <label>代表色</label>
                <input type="color" data-field="color" value="${esc(data.color || '#3498db')}" />
              </div>
            </div>
            <div class="dt-form-row">
              <label>性格</label>
              <textarea data-field="personality" rows="2" placeholder="性格特征描述">${esc(data.personality)}</textarea>
            </div>
            <div class="dt-form-row">
              <label>角色弧光</label>
              <textarea data-field="arc" rows="2" placeholder="从开始到结局的成长曲线">${esc(data.arc)}</textarea>
            </div>
            <div class="dt-form-row">
              <label>与其他人物关系</label>
              <textarea data-field="relation" rows="2" placeholder="如：主角师父；与反派有杀父之仇">${esc(data.relation)}</textarea>
            </div>
            <div class="dt-form-row">
              <label>核心目标</label>
              <textarea data-field="goal" rows="2" placeholder="角色在故事中追求什么">${esc(data.goal)}</textarea>
            </div>
          </div>`,
        submitText: isEdit ? '保存' : '创建',
        onSubmit: async (formEl) => {
          const name = formEl.querySelector('[data-field="name"]').value.trim();
          if (!name) {
            DT().notify('姓名不能为空', 'warning');
            return false;
          }
          const payload = {
            name,
            role: formEl.querySelector('[data-field="role"]').value.trim(),
            identity: formEl.querySelector('[data-field="identity"]').value.trim(),
            level: formEl.querySelector('[data-field="level"]').value.trim(),
            personality: formEl.querySelector('[data-field="personality"]').value.trim(),
            arc: formEl.querySelector('[data-field="arc"]').value.trim(),
            relation: formEl.querySelector('[data-field="relation"]').value.trim(),
            goal: formEl.querySelector('[data-field="goal"]').value.trim(),
            color: formEl.querySelector('[data-field="color"]').value,
          };
          try {
            await DT().storage.saveCharacter(pid, payload);
            DT().notify(isEdit ? '角色已更新' : '角色已创建', 'success');
            await reload();
            return true;
          } catch (err) {
            console.error('[settings] 保存角色失败:', err);
            DT().notify('保存失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      panel.appendChild(overlay);
    }

    function confirmDeleteChar(char) {
      const overlay = createModal({
        title: '删除角色',
        bodyHTML: `<p>确认删除角色「<strong>${esc(char.name)}</strong>」？此操作不可撤销。</p>`,
        submitText: '删除',
        submitClass: 'dt-btn-danger',
        onSubmit: async () => {
          // IStorageBackend 未提供 deleteCharacter；通过保存空 name 实现不可行（name 是主键）。
          // 这里给出明确提示，避免误以为已删除。
          DT().notify('当前存储后端未提供角色删除接口，请通过覆盖编辑处理', 'warning');
          return false;
        },
      });
      panel.appendChild(overlay);
    }

    panel.querySelector('[data-act="new"]').addEventListener('click', () => openEditor(null));
    panel.querySelector('[data-act="refresh"]').addEventListener('click', reload);
    await reload();
  }

  // ==================== Tab 3：人物关系网（SVG） ====================

  async function renderRelations(panel) {
    const pid = currentProjectId();
    if (!pid) {
      panel.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>';
      return;
    }

    panel.innerHTML = `
      <div class="dt-toolbar">
        <h3 class="dt-section-title">人物关系网</h3>
        <div class="dt-toolbar-actions">
          <button class="dt-btn" data-act="refresh">刷新</button>
          <span class="dt-hint">点击节点可编辑角色</span>
        </div>
      </div>
      <div class="dt-relations-wrap"><p class="dt-empty-hint">加载中…</p></div>`;

    let characters = [];

    async function reload() {
      const wrap = panel.querySelector('.dt-relations-wrap');
      try {
        characters = (await DT().storage.listCharacters(pid)) || [];
        if (!characters.length) {
          wrap.innerHTML = '<p class="dt-empty-hint">暂无角色，请先在「角色人设」中创建角色</p>';
          return;
        }
        drawGraph(wrap);
      } catch (err) {
        console.error('[settings] 关系网加载失败:', err);
        wrap.innerHTML = `<p class="dt-empty-hint dt-error">加载失败：${esc(err.message || err)}</p>`;
      }
    }

    function drawGraph(wrap) {
      wrap.innerHTML = '';
      // 布局：环形排列节点
      const W = Math.max(600, Math.min(900, characters.length * 120));
      const H = Math.max(400, Math.min(600, characters.length * 90));
      const cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) / 2 - 60;

      const nodes = characters.map((c, i) => {
        const angle = (i / characters.length) * Math.PI * 2 - Math.PI / 2;
        return {
          char: c,
          x: cx + R * Math.cos(angle),
          y: cy + R * Math.sin(angle),
        };
      });

      // 解析关系：从每个角色的 relation 字段提取「与某角色」的关系描述
      const edges = [];
      const nameMap = new Map(nodes.map((n) => [n.char.name, n]));
      nodes.forEach((n) => {
        const rel = n.char.relation || '';
        if (!rel) return;
        // 简单解析：在 relation 文本中匹配其他角色名
        nodes.forEach((m) => {
          if (m === n) return;
          if (rel.includes(m.char.name)) {
            edges.push({ from: n, to: m, label: rel.slice(0, 20) });
          }
        });
      });

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '100%');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.classList.add('dt-relations-svg');

      // 先画边
      edges.forEach((e) => {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', e.from.x);
        line.setAttribute('y1', e.from.y);
        line.setAttribute('x2', e.to.x);
        line.setAttribute('y2', e.to.y);
        line.setAttribute('class', 'dt-rel-edge');
        svg.appendChild(line);

        // 边上的标签
        if (e.label) {
          const tx = (e.from.x + e.to.x) / 2;
          const ty = (e.from.y + e.to.y) / 2;
          const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          bg.setAttribute('x', tx - e.label.length * 6);
          bg.setAttribute('y', ty - 9);
          bg.setAttribute('width', e.label.length * 12);
          bg.setAttribute('height', 18);
          bg.setAttribute('rx', 9);
          bg.setAttribute('class', 'dt-rel-edge-bg');
          svg.appendChild(bg);
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', tx);
          text.setAttribute('y', ty + 4);
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('class', 'dt-rel-edge-label');
          text.textContent = e.label;
          svg.appendChild(text);
        }
      });

      // 再画节点
      nodes.forEach((n, i) => {
        const color = n.char.color || COLOR_PALETTE[i % COLOR_PALETTE.length];
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `translate(${n.x},${n.y})`);
        g.setAttribute('class', 'dt-rel-node');
        g.style.cursor = 'pointer';

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('r', 24);
        circle.setAttribute('fill', color);
        circle.setAttribute('class', 'dt-rel-node-circle');
        g.appendChild(circle);

        const initial = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        initial.setAttribute('text-anchor', 'middle');
        initial.setAttribute('y', 5);
        initial.setAttribute('fill', '#fff');
        initial.setAttribute('font-size', '16');
        initial.setAttribute('font-weight', 'bold');
        initial.textContent = (n.char.name || '?').charAt(0);
        g.appendChild(initial);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('y', 44);
        label.setAttribute('class', 'dt-rel-node-label');
        label.textContent = n.char.name || '';
        g.appendChild(label);

        // 点击编辑
        g.addEventListener('click', () => openCharEditor(n.char));
        svg.appendChild(g);
      });

      wrap.appendChild(svg);
    }

    async function openCharEditor(char) {
      // 复用角色编辑表单（简化版：只编辑 relation 字段，因为关系网核心是关系）
      const data = { ...char };
      const overlay = createModal({
        title: `编辑「${char.name}」的关系`,
        bodyHTML: `
          <div class="dt-form">
            <div class="dt-form-row">
              <label>与其他人物关系</label>
              <textarea data-field="relation" rows="4" placeholder="如：主角师父；与赵师兄是宿敌；与女主青梅竹马">${esc(data.relation)}</textarea>
              <p class="dt-hint">提示：在文本中包含其他角色的姓名，关系网会自动连线。</p>
            </div>
          </div>`,
        submitText: '保存',
        onSubmit: async (formEl) => {
          const payload = { ...data, relation: formEl.querySelector('[data-field="relation"]').value.trim() };
          try {
            await DT().storage.saveCharacter(pid, payload);
            DT().notify('关系已更新', 'success');
            await reload();
            return true;
          } catch (err) {
            console.error('[settings] 保存关系失败:', err);
            DT().notify('保存失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      panel.appendChild(overlay);
    }

    panel.querySelector('[data-act="refresh"]').addEventListener('click', reload);
    await reload();
  }

  // ---------- 导出 ----------

  NS.renderSettings = renderSettings;
})(window);
