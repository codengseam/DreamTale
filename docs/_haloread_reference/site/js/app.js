(function () {
    'use strict';

    const SETTINGS_KEY = 'reader-settings';
    const DEFAULT_SETTINGS = {
        skin: 'classical',
        theme: 'day',
        font: 'serif',
        fontSize: 18,
        lineHeight: 1.9,
        paragraphSpacing: 1.0,
        wallpaper: 'none',
        wallpaperOpacity: 0.6,
        pageMode: 'tap',
        autoScroll: false,
        autoScrollSpeed: 50
    };

    // 本地缓存键
    const CACHE_PREFIX = 'halo-';
    const CACHE_VERSION = 'v1';
    const INDEX_CACHE_KEY = CACHE_PREFIX + 'index';
    const INDEX_META_KEY = CACHE_PREFIX + 'index-meta';
    const SEARCH_CACHE_KEY = CACHE_PREFIX + 'search-index';
    const SEARCH_META_KEY = CACHE_PREFIX + 'search-meta';
    const NOTE_CACHE_PREFIX = CACHE_PREFIX + 'note-';
    const MAX_CACHED_NOTES = 50;

    const state = {
        booksData: [],
        categories: [],
        displayTaxonomy: {},
        displayCategoryOrder: [],
        treeData: [],
        notesIndex: {},
        flatNotes: [],
        currentView: 'home', // 'home' | 'reader'
        currentBook: null,
        currentBookTree: [],
        activePath: null,
        searchQuery: '',
        selectedCategory: 'all',
        bookshelfQuery: '',
        searchMode: false,
        searchIndexLoaded: false,
        searchNotes: [],
        scrollObserver: null
    };

    const elements = {
        homeView: document.getElementById('homeView'),
        readerView: document.getElementById('readerView'),
        bookshelfGrid: document.getElementById('bookshelfGrid'),
        categoryTabs: document.getElementById('categoryTabs'),
        bookshelfSearchInput: document.getElementById('bookshelfSearchInput'),
        brandLockup: document.getElementById('brandLockup'),
        skinBtns: document.getElementById('skinBtns'),
        heroStats: document.getElementById('heroStats'),
        treeNav: document.getElementById('treeNav'),
        reader: document.getElementById('reader'),
        readerWallpaper: document.querySelector('.reader-wallpaper'),
        backBtn: document.getElementById('backBtn'),
        currentBookTitle: document.getElementById('currentBookTitle'),
        newNoteBtn: document.getElementById('newNoteBtn'),
        newNoteLink: document.getElementById('newNoteLink'),
        newNoteBtnToolbar: document.getElementById('newNoteBtnToolbar'),
        searchInput: document.getElementById('searchInput'),
        refreshBtn: document.getElementById('refreshBtn'),
        menuBtn: document.getElementById('menuBtn'),
        sidebar: document.querySelector('.reader-view .sidebar'),
        sidebarOverlay: document.getElementById('sidebarOverlay'),
        toolbarChapter: document.getElementById('toolbarChapter'),
        settingsBtn: document.getElementById('settingsBtn'),
        settingsBtnHeader: document.getElementById('settingsBtnHeader'),
        settingsBtnBottom: document.getElementById('settingsBtnBottom'),
        settingsPanel: document.getElementById('settingsPanel'),
        settingsOverlay: document.getElementById('settingsOverlay'),
        settingsClose: document.getElementById('settingsClose'),
        fontBtns: document.getElementById('fontBtns'),
        themeBtns: document.getElementById('themeBtns'),
        fontSizeRange: document.getElementById('fontSizeRange'),
        fontSizeVal: document.getElementById('fontSizeVal'),
        lineHeightRange: document.getElementById('lineHeightRange'),
        lineHeightVal: document.getElementById('lineHeightVal'),
        paragraphSpacingRange: document.getElementById('paragraphSpacingRange'),
        paragraphSpacingVal: document.getElementById('paragraphSpacingVal'),
        resetSettingsBtn: document.getElementById('resetSettingsBtn'),
        prevBtnBottom: document.getElementById('prevBtnBottom'),
        nextBtnBottom: document.getElementById('nextBtnBottom'),
        tocBtnBottom: document.getElementById('tocBtnBottom'),
        modalOverlay: document.getElementById('modalOverlay'),
        modalClose: document.getElementById('modalClose'),
        cancelBtn: document.getElementById('cancelBtn'),
        immersiveBtn: document.getElementById('immersiveBtn'),
        wallpaperBtns: document.getElementById('wallpaperBtns'),
        wallpaperOpacityRange: document.getElementById('wallpaperOpacityRange'),
        wallpaperOpacityVal: document.getElementById('wallpaperOpacityVal'),
        pageModeBtns: document.getElementById('pageModeBtns'),
        autoScrollBtns: document.getElementById('autoScrollBtns'),
        autoScrollSpeedRange: document.getElementById('autoScrollSpeedRange'),
        autoScrollSpeedVal: document.getElementById('autoScrollSpeedVal'),
        offlineExportBtn: document.getElementById('offlineExportBtn'),
        exportOverlay: document.getElementById('exportOverlay'),
        exportClose: document.getElementById('exportClose'),
        exportBookTip: document.getElementById('exportBookTip'),
        exportTree: document.getElementById('exportTree'),
        exportSelectAllBtn: document.getElementById('exportSelectAllBtn'),
        exportClearBtn: document.getElementById('exportClearBtn'),
        exportCounter: document.getElementById('exportCounter'),
        exportConfirmBtn: document.getElementById('exportConfirmBtn'),
        exportCancelBtn: document.getElementById('exportCancelBtn'),
        exportProgress: document.getElementById('exportProgress'),
        exportProgressFill: document.getElementById('exportProgressFill'),
        exportProgressText: document.getElementById('exportProgressText')
    };

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function sanitizeHtml(html) {
        html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        html = html.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
        html = html.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
        html = html.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
        return html;
    }

    function showError(message, err) {
        console.error(message, err || '');
        alert(message);
    }

    /* ============ 本地缓存工具 ============ */
    function getCachedJson(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (err) {
            return null;
        }
    }

    function setCachedJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
            // 存储配额不足时静默失败
        }
    }

    function getCachedText(key) {
        try {
            return localStorage.getItem(key);
        } catch (err) {
            return null;
        }
    }

    function setCachedText(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (err) {
            // 存储配额不足时静默失败
        }
    }

    function clearOutdatedCache() {
        const versionKey = CACHE_PREFIX + 'cache-version';
        try {
            const stored = localStorage.getItem(versionKey);
            if (stored === CACHE_VERSION) return;
        } catch (err) {
            return;
        }
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && key.startsWith(CACHE_PREFIX)) {
                localStorage.removeItem(key);
            }
        }
        try {
            localStorage.setItem(versionKey, CACHE_VERSION);
        } catch (err) {
            // ignore
        }
    }

    function cleanupNoteCache(maxCount) {
        const entries = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(NOTE_CACHE_PREFIX) && !key.endsWith('-meta')) {
                const meta = getCachedJson(key + '-meta') || {};
                entries.push({ key: key, loadedAt: meta.loaded_at || 0 });
            }
        }
        if (entries.length <= maxCount) return;
        entries.sort((a, b) => a.loadedAt - b.loadedAt);
        entries.slice(0, entries.length - maxCount).forEach((item) => {
            localStorage.removeItem(item.key);
            localStorage.removeItem(item.key + '-meta');
        });
    }

    async function loadCachedThenFetch(url, cacheKey, metaKey, onData) {
        const cached = getCachedJson(cacheKey);
        const meta = getCachedJson(metaKey);

        // 有缓存先渲染，后台静默更新
        if (cached && meta && meta.generated_at) {
            onData(cached);
        }

        try {
            const data = await fetchJson(url, { cache: 'no-cache' });
            setCachedJson(cacheKey, data);
            setCachedJson(metaKey, {
                version: data.version || '',
                generated_at: data.generated_at || ''
            });
            // 只有数据变化才再次触发渲染，避免闪烁
            if (!cached || meta?.generated_at !== data.generated_at) {
                onData(data);
            }
            return data;
        } catch (err) {
            if (cached) {
                console.warn('[豪书斋] 网络请求失败，使用缓存数据:', url, err);
                return cached;
            }
            throw err;
        }
    }

    async function fetchJson(url, options) {
        const response = await fetch(url, options);
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(`请求失败 (${response.status}): ${detail || response.statusText}`);
        }
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return await response.json();
        }
        return await response.text();
    }

    function flattenTree(nodes) {
        const result = [];
        function walk(list) {
            if (!list) return;
            for (const node of list) {
                if (Array.isArray(node.children) && node.children.length > 0) {
                    walk(node.children);
                } else if (node.path) {
                    result.push(node);
                }
            }
        }
        walk(nodes);
        return result;
    }

    function nodeMatches(node, query) {
        const text = (node.title || '').toLowerCase();
        return text.includes(query);
    }

    function filterTree(nodes, query) {
        if (!query) return nodes;
        const result = [];
        for (const node of nodes) {
            const children = node.children ? filterTree(node.children, query) : [];
            const matched = nodeMatches(node, query);
            if (matched || children.length > 0) {
                const clone = Object.assign({}, node);
                if (children.length > 0) {
                    clone.children = children;
                }
                result.push(clone);
            }
        }
        return result;
    }

    function expandMatchedNodes(container) {
        if (!state.searchQuery) return;
        const matchedLeaves = container.querySelectorAll('.tree-leaf');
        matchedLeaves.forEach((leaf) => {
            let parent = leaf.closest('.tree-node');
            while (parent) {
                parent.classList.add('expanded');
                parent = parent.parentElement.closest('.tree-node');
            }
        });
    }

    function getNodeIcon(node, isLeaf) {
        if (isLeaf) return '📝';
        if (node.type === 'book') return '📖';
        if (node.type === 'chapter') return '📑';
        return '📁';
    }

    function renderTree(nodes, depth = 0) {
        if (!nodes || nodes.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = '暂无笔记';
            return empty;
        }
        const ul = document.createElement('ul');
        ul.className = 'tree-list';

        nodes.forEach((node) => {
            const hasChildren = Array.isArray(node.children) && node.children.length > 0;
            const li = document.createElement('li');
            li.className = 'tree-node' + (hasChildren ? ' expanded' : '');
            li.dataset.depth = String(depth);

            const icon = getNodeIcon(node, !hasChildren);
            const title = escapeHtml(node.title || '未命名');

            if (hasChildren) {
                const toggle = document.createElement('button');
                toggle.className = 'tree-toggle';
                toggle.type = 'button';
                toggle.innerHTML = `<span class="tree-arrow" aria-hidden="true">▶</span><span class="tree-icon">${icon}</span><span>${title}</span>`;
                toggle.addEventListener('click', () => {
                    li.classList.toggle('expanded');
                });
                li.appendChild(toggle);

                const childrenContainer = document.createElement('ul');
                childrenContainer.className = 'tree-children';
                childrenContainer.appendChild(renderTree(node.children, depth + 1));
                li.appendChild(childrenContainer);
            } else {
                const leaf = document.createElement('button');
                leaf.className = 'tree-leaf';
                leaf.type = 'button';
                leaf.dataset.path = node.path || '';
                leaf.innerHTML = `<span class="tree-icon">${icon}</span><span>${title}</span>`;
                leaf.addEventListener('click', () => {
                    loadNote(node.path, leaf);
                    closeSidebar();
                });
                if (state.activePath && state.activePath === node.path) {
                    leaf.classList.add('active');
                }
                li.appendChild(leaf);
            }

            ul.appendChild(li);
        });

        return ul;
    }

    function refreshTreeView() {
        const filtered = filterTree(state.currentBookTree, state.searchQuery);
        const rendered = renderTree(filtered);
        elements.treeNav.innerHTML = '';
        elements.treeNav.appendChild(rendered);
        expandMatchedNodes(elements.treeNav);
    }

    /* ============ 首页 / 书架 ============ */
    // 阿拉伯数字 → 简练中文计数
    function cnNum(n) {
        if (n <= 0) return '零';
        var digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
        if (n < 10) return digits[n];
        if (n < 20) return '十' + (n % 10 ? digits[n % 10] : '');
        if (n < 100) {
            var t = Math.floor(n / 10), o = n % 10;
            return digits[t] + '十' + (o ? digits[o] : '');
        }
        return String(n);
    }

    // 书脊配色：按一级栏分色
    var spinePalette = {
        ren:     { bg: '#6b4226', fg: '#f4ecda' },
        shi:     { bg: '#34404a', fg: '#eef0f2' },
        cai:     { bg: '#83261c', fg: '#f7eed8' },
        shijian: { bg: '#2e2620', fg: '#e6dcc4' },
        other:   { bg: '#555', fg: '#eee' }
    };

    // 各栏名言 / 导语（全部 tab 用默认 Hero 文案）
    var heroQuotes = {
        all: { eyebrow: '— 卷帙浩繁 · 开卷有益 —', title: '豪书斋', slogan: '读古人书<span class="dot">·</span>悟今世事', desc: '取王立群「琢磨事、人、钱」之框架，益以「认识世界」一脉，分四部以归列专栏。左图右史，开卷了然；以古鉴今，知行合一。' },
        ren: { eyebrow: '— 人鉴 —', title: '观人察己', slogan: '知人者智<span class="dot">·</span>自知者明', desc: '《道德经》曰：「知人者智，自知者明。」此部收心、学、养生、礼仪之学，助人先修己身，再观世态。' },
        shi: { eyebrow: '— 事功 —', title: '经事致用', slogan: '君子务本<span class="dot">·</span>本立而道生', desc: '《论语》曰：「君子务本，本立而道生。」此部收技能、职场、升学之篇，以古训为根基，练成事之能。' },
        cai: { eyebrow: '— 货殖 —', title: '货殖生财', slogan: '取之有度<span class="dot">·</span>用之有节', desc: '《史记·货殖列传》：「天下熙熙，皆为利来；天下攘攘，皆为利往。」此部收财、商之道，重稳健生财，而非逐利忘义。' },
        shijian: { eyebrow: '— 世鉴 —', title: '鉴往知今', slogan: '以史为鉴<span class="dot">·</span>可以知兴替', desc: '《资治通鉴》曰：「鉴于往事，有资于治道。」此部收经史之卷，读古以观今，知兴替、明得失。' }
    };

    function renderHeroStats(stats) {
        if (!stats) {
            elements.heroStats.innerHTML = '<span>正在统计书目…</span>';
            return;
        }
        elements.heroStats.innerHTML =
            '<div class="stat"><span class="stat-value">' + (stats.books || 0) + '</span><span class="stat-label">部典籍</span></div>' +
            '<div class="stat"><span class="stat-value">' + (stats.notes || 0) + '</span><span class="stat-label">篇笔记</span></div>' +
            '<div class="stat"><span class="stat-value">' + (state.displayCategoryOrder.length || 4) + '</span><span class="stat-label">个分类</span></div>';
    }

    // 四栏 Tab：全部 + 人/事/财/世
    function renderCategoryTabs() {
        var container = elements.categoryTabs;
        container.innerHTML = '';

        var order = ['all'].concat(state.displayCategoryOrder);
        order.forEach(function (cat) {
            var el = document.createElement('button');
            el.className = 'category-tab' + (state.selectedCategory === cat ? ' active' : '');
            el.dataset.category = cat;
            el.setAttribute('role', 'tab');
            el.setAttribute('aria-selected', state.selectedCategory === cat ? 'true' : 'false');
            el.type = 'button';

            if (cat === 'all') {
                el.textContent = '全部';
            } else {
                var t = state.displayTaxonomy[cat] || {};
                var count = state.booksData.filter(function (b) { return b.display_category === cat; }).length;
                el.innerHTML = t.short + '<span class="tab-count">' + count + '</span>';
            }
            el.addEventListener('click', function () { selectCategory(cat); });
            container.appendChild(el);
        });
    }

    function selectCategory(category) {
        state.selectedCategory = category;
        renderHeroContent(category);
        renderCategoryTabs();
        renderBookshelf();
    }

    function renderHeroContent(category) {
        // 图一 Hero 固定展示，分类切换时不改变文案
        var hero = document.querySelector('.hero');
        if (hero) {
            hero.classList.toggle('category-hero', category !== 'all');
        }
    }

    function filterBooks() {
        var books = state.booksData;

        if (state.selectedCategory !== 'all') {
            books = books.filter(function (book) { return book.display_category === state.selectedCategory; });
        }

        var query = state.bookshelfQuery.trim().toLowerCase();
        if (query) {
            books = books.filter(function (book) {
                var title = (book.title || '').toLowerCase();
                var author = (book.author || '').toLowerCase();
                var category = (book.category || '').toLowerCase();
                var description = (book.description || '').toLowerCase();
                return title.includes(query) || author.includes(query) || category.includes(query) || description.includes(query);
            });
        }

        return books;
    }

    function renderBookshelf() {
        var container = elements.bookshelfGrid;
        container.innerHTML = '';

        var books = filterBooks();

        if (books.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = state.bookshelfQuery ? '未找到匹配的书籍' : '书架暂无书籍';
            container.appendChild(empty);
            return;
        }

        books.forEach(function (b) {
            var card = document.createElement('a');
            card.className = 'book-card';
            card.href = 'javascript:void(0)';
            card.innerHTML =
                '<div class="book-cover">' +
                    '<div class="book-cover-title">' + (b.title || b.id) + '</div>' +
                '</div>' +
                '<div class="book-info">' +
                    '<div class="book-meta">' +
                        '<div class="book-category">' + (b.display_subcategory || b.category || '书') + '</div>' +
                        '<div class="book-stats">' + (b.note_count || 0) + ' 篇笔记</div>' +
                    '</div>' +
                    (b.author ? '<div class="book-author">' + b.author + '</div>' : '') +
                    '<div class="book-description">' + (b.description || '') + '</div>' +
                '</div>';
            card.addEventListener('click', function () { openBook(b.id); });
            container.appendChild(card);
        });
    }

    function handleBookshelfSearch(event) {
        state.bookshelfQuery = event.target.value;
        renderBookshelf();
    }

    /* ============ 视图切换 ============ */
    function switchView(view) {
        state.currentView = view;
        document.body.dataset.view = view;
        if (view === 'home') {
            pauseAutoScroll();
            // 返回首页时退出沉浸模式，避免 immersive-mode 影响 home 视图布局
            if (document.body.classList.contains('immersive-mode')) {
                exitImmersiveMode();
            }
            elements.homeView.hidden = false;
            elements.readerView.hidden = true;
            document.body.style.overflow = '';
            if (elements.immersiveBtn) elements.immersiveBtn.hidden = true;
        } else {
            elements.homeView.hidden = true;
            elements.readerView.hidden = false;
            document.body.style.overflow = 'hidden';
            // 沉浸按钮在阅读视图可见（所有环境，不限于魔搭嵌入）
            if (elements.immersiveBtn) elements.immersiveBtn.hidden = false;
        }
    }

    function openBook(bookId, chapterPath) {
        const book = state.booksData.find((b) => b.id === bookId);
        if (!book) {
            const bookNode = state.treeData.find((b) => b.title === bookId);
            if (!bookNode) return;
            state.currentBook = bookId;
            state.currentBookTree = [bookNode];
        } else {
            state.currentBook = bookId;
            state.currentBookTree = book.tree || [];
        }
        state.activePath = null;

        switchView('reader');
        if (elements.currentBookTitle) {
            elements.currentBookTitle.textContent = (book && book.title) || bookId;
        }
        elements.reader.innerHTML = '<div class="reader-placeholder"><p>正在加载…</p></div>';
        refreshTreeView();

        const bookNotes = flattenTree(state.currentBookTree);
        // 优先跳转到 URL 指定章节，其次缓存页，最后第一章
        if (chapterPath && bookNotes.some((n) => n.path === chapterPath)) {
            loadNote(chapterPath);
        } else {
            const cachedPath = getCachedPosition(bookId);
            if (cachedPath && bookNotes.some((n) => n.path === cachedPath)) {
                loadNote(cachedPath);
            } else if (bookNotes.length > 0) {
                loadNote(bookNotes[0].path);
            }
        }
    }

    // 从 URL 参数 ?book=&chapter= 自动打开书并定位章节（供人物卡片等外部链接深跳转）
    function openBookFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const bookId = params.get('book');
        const chapter = params.get('chapter');
        if (!bookId) return;
        // chapter 参数为「章节_事件」形式，需拼成相对路径 book/chapter_event.md
        if (chapter) {
            const chapterPath = bookId + '/' + chapter + '.md';
            openBook(bookId, chapterPath);
        } else {
            openBook(bookId);
        }
    }

    function backToHome() {
        state.currentBook = null;
        state.currentBookTree = [];
        state.activePath = null;
        state.searchQuery = '';
        if (elements.searchInput) elements.searchInput.value = '';
        // 返回书架时强制关闭所有遮罩层，避免 sidebar/settings/modal 的蒙层残留在首页
        closeSidebar();
        closeSettings();
        closeModal();
        switchView('home');
        renderBookshelf();
    }

    /* ============ 笔记加载 ============ */
    function parseFrontmatter(content) {
        const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n*/);
        if (!match) return { meta: null, body: content };
        const metaBlock = match[1];
        const body = content.slice(match[0].length);
        const meta = {};
        metaBlock.split('\n').forEach((line) => {
            const idx = line.indexOf(':');
            if (idx === -1) return;
            const key = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
            if (key) meta[key] = value;
        });
        return { meta, body };
    }

    function buildMetaHtml(meta) {
        if (!meta || (!meta.title && !meta.created_at)) return '';
        let html = '<div class="note-meta">';
        if (meta.title) html += `<span class="note-meta-title">${escapeHtml(meta.title)}</span>`;
        if (meta.book || meta.chapter) {
            html += `<span class="note-meta-path">${escapeHtml([meta.book, meta.chapter].filter(Boolean).join(' / '))}</span>`;
        }
        if (meta.created_at) html += `<span class="note-meta-date">${escapeHtml(meta.created_at)}</span>`;
        html += '</div>';
        return html;
    }

    function buildChapterNavHtml(prevNode, nextNode) {
        const prevDisabled = prevNode ? '' : 'disabled';
        const nextDisabled = nextNode ? '' : 'disabled';
        const prevLabel = prevNode ? `上一章 · ${escapeHtml(prevNode.title || '')}` : '已是第一章';
        const nextLabel = nextNode ? `下一章 · ${escapeHtml(nextNode.title || '')}` : '已是最后一章';
        return `<nav class="chapter-nav">` +
            `<button type="button" class="chapter-btn prev" id="prevChapterBtn" ${prevDisabled}>${prevLabel}</button>` +
            `<button type="button" class="chapter-btn next" id="nextChapterBtn" ${nextDisabled}>${nextLabel}</button>` +
            `</nav>`;
    }

    function updateChapterNav() {
        const list = state.flatNotes;
        const idx = list.findIndex((n) => n.path === state.activePath);
        const prev = idx > 0 ? list[idx - 1] : null;
        const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

        const prevBtn = document.getElementById('prevChapterBtn');
        const nextBtn = document.getElementById('nextChapterBtn');
        if (prevBtn) {
            prevBtn.disabled = !prev;
            prevBtn.textContent = prev ? `上一章 · ${prev.title || ''}` : '已是第一章';
        }
        if (nextBtn) {
            nextBtn.disabled = !next;
            nextBtn.textContent = next ? `下一章 · ${next.title || ''}` : '已是最后一章';
        }

        if (elements.prevBtnBottom) {
            elements.prevBtnBottom.disabled = !prev;
        }
        if (elements.nextBtnBottom) {
            elements.nextBtnBottom.disabled = !next;
        }
    }

    function bindChapterNavButtons() {
        const prevBtn = document.getElementById('prevChapterBtn');
        const nextBtn = document.getElementById('nextChapterBtn');
        if (prevBtn) {
            prevBtn.addEventListener('click', goPrevChapter);
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', goNextChapter);
        }
    }

    function goPrevChapter() {
        const idx = state.flatNotes.findIndex((n) => n.path === state.activePath);
        if (idx > 0) {
            pauseAutoScroll();
            loadNote(state.flatNotes[idx - 1].path);
        }
    }

    function goNextChapter() {
        const idx = state.flatNotes.findIndex((n) => n.path === state.activePath);
        if (idx >= 0 && idx < state.flatNotes.length - 1) {
            pauseAutoScroll();
            loadNote(state.flatNotes[idx + 1].path);
        }
    }

    async function loadNote(path, targetElement) {
        if (!path) return;
        pauseAutoScroll();
        state.activePath = path;

        const allLeaves = elements.treeNav.querySelectorAll('.tree-leaf');
        allLeaves.forEach((leaf) => leaf.classList.remove('active'));
        if (targetElement) {
            targetElement.classList.add('active');
        } else {
            const match = elements.treeNav.querySelector(`.tree-leaf[data-path="${CSS.escape(path)}"]`);
            if (match) match.classList.add('active');
        }

        elements.reader.innerHTML = '<div class="reader-placeholder">正在加载笔记…</div>';
        elements.reader.scrollTop = 0;
        try {
            const content = await fetchJson('notes/' + encodeURI(path));
            const { meta, body } = parseFrontmatter(content || '');
            const html = sanitizeHtml(marked.parse(body, { gfm: true }));
            const metaHtml = buildMetaHtml(meta);

            const idx = state.flatNotes.findIndex((n) => n.path === path);
            const prev = idx > 0 ? state.flatNotes[idx - 1] : null;
            const next = idx >= 0 && idx < state.flatNotes.length - 1 ? state.flatNotes[idx + 1] : null;
            const navHtml = buildChapterNavHtml(prev, next);

            elements.reader.innerHTML = `<div class="reader-wallpaper" aria-hidden="true"></div><article class="markdown-body">${metaHtml}${html}</article>${navHtml}`;
            // 重新获取壁纸层引用（innerHTML 会重建 DOM）
            elements.readerWallpaper = elements.reader.querySelector('.reader-wallpaper');
            bindChapterNavButtons();
            updateReaderWallpaperHeight();

            if (elements.toolbarChapter) {
                const chapterText = meta && meta.title ? meta.title : (state.flatNotes[idx] && state.flatNotes[idx].title) || '';
                elements.toolbarChapter.textContent = chapterText;
            }
            updateChapterNav();

            // 缓存当前阅读位置
            if (state.currentBook) {
                saveCachedPosition(state.currentBook, path);
            }
        } catch (err) {
            elements.reader.innerHTML = '<div class="reader-placeholder">加载失败，请重试。</div>';
            showError('无法加载笔记内容。', err);
        }
    }

    /* ============ 数据加载（静态站点） ============ */
    function applyIndexData(data) {
        state.booksData = data.books || [];
        state.categories = data.categories || [];
        state.displayTaxonomy = data.display_taxonomy || {};
        state.displayCategoryOrder = data.display_category_order || [];
        state.treeData = data.tree || [];
        state.flatNotes = flattenTree(state.treeData);
        state.searchMode = false;
    }

    async function loadIndex() {
        try {
            await loadCachedThenFetch(
                'data/index.json',
                INDEX_CACHE_KEY,
                INDEX_META_KEY,
                (data) => {
                    applyIndexData(data);
                    renderHeroContent(state.selectedCategory);
                    renderHeroStats(data.stats);
                    renderCategoryTabs();
                    renderBookshelf();
                    updateChapterNav();
                    // 数据就绪后检查 URL 参数，支持 ?book=&chapter= 深跳转
                    openBookFromUrl();
                }
            );
        } catch (err) {
            elements.bookshelfGrid.innerHTML = '';
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = '加载书架失败';
            elements.bookshelfGrid.appendChild(empty);
            showError('无法加载书架数据，请检查 data/index.json 是否存在。', err);
        }
    }

    async function loadTree() {
        try {
            await loadCachedThenFetch(
                'data/index.json',
                INDEX_CACHE_KEY,
                INDEX_META_KEY,
                (data) => {
                    applyIndexData(data);
                    if (state.currentBook) {
                        const bookNode = state.treeData.find((b) => b.title === state.currentBook);
                        state.currentBookTree = bookNode ? [bookNode] : state.treeData;
                    } else {
                        state.currentBookTree = state.treeData;
                    }
                    refreshTreeView();
                    updateChapterNav();
                }
            );
        } catch (err) {
            showError('无法加载笔记目录，请检查 data/index.json 是否存在。', err);
        }
    }

    async function ensureSearchIndex() {
        if (state.searchIndexLoaded) return state.searchNotes;
        await loadCachedThenFetch(
            'data/search-index.json',
            SEARCH_CACHE_KEY,
            SEARCH_META_KEY,
            (data) => {
                state.searchNotes = data.notes || [];
                state.searchIndexLoaded = true;
            }
        );
        if (!state.searchIndexLoaded) {
            state.searchNotes = [];
            state.searchIndexLoaded = true;
        }
        return state.searchNotes;
    }

    /* ============ 阅读设置 ============ */
    const VALID_WALLPAPERS = ['none', 'bamboo', 'landscape'];
    const VALID_SKINS = ['classical', 'modern'];

    function normalizeSettings(settings) {
        const s = Object.assign({}, settings);
        // 已删除的壁纸回退到无
        if (!VALID_WALLPAPERS.includes(s.wallpaper)) {
            s.wallpaper = 'none';
        }
        if (!VALID_SKINS.includes(s.skin)) {
            s.skin = 'classical';
        }
        return s;
    }

    function loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return Object.assign({}, DEFAULT_SETTINGS);
            const parsed = JSON.parse(raw);
            return normalizeSettings(Object.assign({}, DEFAULT_SETTINGS, parsed));
        } catch (err) {
            return Object.assign({}, DEFAULT_SETTINGS);
        }
    }

    function saveSettings(settings) {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (err) {
            // 存储失败时静默处理
        }
    }

    /* ============ 阅读位置缓存 ============ */
    function getCachedPosition(bookId) {
        try {
            return localStorage.getItem('reader-position-' + bookId);
        } catch (err) {
            return null;
        }
    }

    function saveCachedPosition(bookId, path) {
        try {
            if (bookId && path) {
                localStorage.setItem('reader-position-' + bookId, path);
            }
        } catch (err) {
            // 存储失败时静默处理
        }
    }

    function applySettings(settings) {
        const s = normalizeSettings(settings);
        document.body.setAttribute('data-skin', s.skin);
        document.body.setAttribute('data-theme', s.theme);
        document.body.setAttribute('data-font', s.font);
        document.body.setAttribute('data-wallpaper', s.wallpaper);
        document.body.setAttribute('data-page-mode', s.pageMode);
        document.documentElement.style.setProperty('--reader-font-size', s.fontSize + 'px');
        document.documentElement.style.setProperty('--reader-line-height', String(s.lineHeight));
        document.documentElement.style.setProperty('--reader-paragraph-spacing', s.paragraphSpacing + 'em');
        document.documentElement.style.setProperty('--reader-wallpaper-opacity', String(s.wallpaperOpacity));

        // 古典皮肤需要 webfont，现代皮肤用系统字体
        updateFontLink(s.skin);

        if (elements.fontSizeRange) elements.fontSizeRange.value = s.fontSize;
        if (elements.lineHeightRange) elements.lineHeightRange.value = s.lineHeight;
        if (elements.paragraphSpacingRange) elements.paragraphSpacingRange.value = s.paragraphSpacing;
        if (elements.fontSizeVal) elements.fontSizeVal.textContent = s.fontSize + 'px';
        if (elements.lineHeightVal) elements.lineHeightVal.textContent = s.lineHeight;
        if (elements.paragraphSpacingVal) elements.paragraphSpacingVal.textContent = s.paragraphSpacing.toFixed(1) + 'em';
        if (elements.wallpaperOpacityRange) elements.wallpaperOpacityRange.value = s.wallpaperOpacity;
        if (elements.wallpaperOpacityVal) elements.wallpaperOpacityVal.textContent = s.wallpaperOpacity.toFixed(1);
        if (elements.autoScrollSpeedRange) elements.autoScrollSpeedRange.value = s.autoScrollSpeed;
        if (elements.autoScrollSpeedVal) elements.autoScrollSpeedVal.textContent = String(s.autoScrollSpeed);

        if (elements.fontBtns) {
            elements.fontBtns.querySelectorAll('button').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.font === s.font);
            });
        }
        if (elements.skinBtns) {
            elements.skinBtns.querySelectorAll('button').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.skin === s.skin);
            });
        }
        if (elements.themeBtns) {
            elements.themeBtns.querySelectorAll('button').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.theme === s.theme);
            });
        }
        if (elements.wallpaperBtns) {
            elements.wallpaperBtns.querySelectorAll('button').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.wallpaper === s.wallpaper);
            });
        }
        if (elements.pageModeBtns) {
            elements.pageModeBtns.querySelectorAll('button').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.pageMode === s.pageMode);
            });
        }
        if (elements.autoScrollBtns) {
            elements.autoScrollBtns.querySelectorAll('button').forEach((btn) => {
                const isActive = (btn.dataset.autoScroll === 'true') === Boolean(s.autoScroll);
                btn.classList.toggle('active', isActive);
            });
        }
        updateReaderWallpaperHeight();
    }

    function updateReaderWallpaperHeight() {
        if (!elements.readerWallpaper || !elements.reader) return;
        // 让壁纸层高度始终等于阅读区滚动内容高度，保证长文壁纸铺满
        elements.readerWallpaper.style.height = elements.reader.scrollHeight + 'px';
    }

    // 已移除 Google Fonts 依赖：全部使用系统字体栈，保证各浏览器/网络环境渲染一致。
    // 保留空函数以避免旧版设置数据触发异常。
    function updateFontLink(skin) {
        // no-op
    }

    function openSettings() {
        pauseAutoScroll();
        elements.settingsPanel.classList.add('open');
        elements.settingsPanel.setAttribute('aria-hidden', 'false');
        elements.settingsOverlay.classList.add('open');
    }

    function closeSettings() {
        elements.settingsPanel.classList.remove('open');
        elements.settingsPanel.setAttribute('aria-hidden', 'true');
        elements.settingsOverlay.classList.remove('open');
    }

    function initSettings() {
        const settings = loadSettings();
        applySettings(settings);

        [elements.settingsBtn, elements.settingsBtnHeader, elements.settingsBtnBottom].forEach(function(btn) {
            if (btn) btn.addEventListener('click', openSettings);
        });
        if (elements.settingsClose) {
            elements.settingsClose.addEventListener('click', closeSettings);
        }
        if (elements.settingsOverlay) {
            elements.settingsOverlay.addEventListener('click', closeSettings);
        }

        if (elements.fontBtns) {
            elements.fontBtns.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-font]');
                if (!btn) return;
                const s = loadSettings();
                s.font = btn.dataset.font;
                saveSettings(s);
                applySettings(s);
            });
        }

        if (elements.skinBtns) {
            elements.skinBtns.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-skin]');
                if (!btn) return;
                const s = loadSettings();
                s.skin = btn.dataset.skin;
                saveSettings(s);
                applySettings(s);
            });
        }

        if (elements.themeBtns) {
            elements.themeBtns.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-theme]');
                if (!btn) return;
                const s = loadSettings();
                s.theme = btn.dataset.theme;
                saveSettings(s);
                applySettings(s);
            });
        }

        if (elements.fontSizeRange) {
            elements.fontSizeRange.addEventListener('input', (e) => {
                const s = loadSettings();
                s.fontSize = parseInt(e.target.value, 10);
                saveSettings(s);
                applySettings(s);
            });
        }

        if (elements.lineHeightRange) {
            elements.lineHeightRange.addEventListener('input', (e) => {
                const s = loadSettings();
                s.lineHeight = parseFloat(e.target.value);
                saveSettings(s);
                applySettings(s);
            });
        }

        if (elements.paragraphSpacingRange) {
            elements.paragraphSpacingRange.addEventListener('input', (e) => {
                const s = loadSettings();
                s.paragraphSpacing = parseFloat(e.target.value);
                saveSettings(s);
                applySettings(s);
            });
        }

        if (elements.wallpaperBtns) {
            elements.wallpaperBtns.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-wallpaper]');
                if (!btn) return;
                const s = loadSettings();
                s.wallpaper = btn.dataset.wallpaper;
                saveSettings(s);
                applySettings(s);
            });
        }

        if (elements.wallpaperOpacityRange) {
            elements.wallpaperOpacityRange.addEventListener('input', (e) => {
                const s = loadSettings();
                s.wallpaperOpacity = parseFloat(e.target.value);
                saveSettings(s);
                applySettings(s);
            });
        }

        if (elements.pageModeBtns) {
            elements.pageModeBtns.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-page-mode]');
                if (!btn) return;
                const s = loadSettings();
                s.pageMode = btn.dataset.pageMode;
                saveSettings(s);
                applySettings(s);
            });
        }

        if (elements.autoScrollSpeedRange) {
            elements.autoScrollSpeedRange.addEventListener('input', (e) => {
                const s = loadSettings();
                s.autoScrollSpeed = parseInt(e.target.value, 10);
                saveSettings(s);
                applySettings(s);
            });
        }

        if (elements.autoScrollBtns) {
            elements.autoScrollBtns.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-auto-scroll]');
                if (!btn) return;
                const s = loadSettings();
                s.autoScroll = btn.dataset.autoScroll === 'true';
                saveSettings(s);
                applySettings(s);
                if (s.autoScroll) {
                    startAutoScroll();
                } else {
                    pauseAutoScroll();
                }
            });
        }

        if (elements.resetSettingsBtn) {
            elements.resetSettingsBtn.addEventListener('click', () => {
                pauseAutoScroll();
                saveSettings(DEFAULT_SETTINGS);
                applySettings(DEFAULT_SETTINGS);
            });
        }
    }

    /* ============ 移动端抽屉 ============ */
    function openSidebar() {
        if (!elements.sidebar) return;
        elements.sidebar.classList.add('open');
        if (elements.sidebarOverlay) elements.sidebarOverlay.classList.add('open');
    }

    function closeSidebar() {
        if (!elements.sidebar) return;
        elements.sidebar.classList.remove('open');
        if (elements.sidebarOverlay) elements.sidebarOverlay.classList.remove('open');
    }

    function initSidebarDrawer() {
        if (elements.menuBtn) {
            elements.menuBtn.addEventListener('click', openSidebar);
        }
        if (elements.tocBtnBottom) {
            elements.tocBtnBottom.addEventListener('click', openSidebar);
        }
        if (elements.sidebarOverlay) {
            elements.sidebarOverlay.addEventListener('click', closeSidebar);
        }
    }

    /* ============ 翻页交互（点击分区 + 滑动） ============ */
    // 模块级标志：touch 触发的轻点已处理时，阻止后续 click 重复触发
    let tapHandledByTouch = false;
    // touchstart 起点信息，用于 touchend 判断轻点 vs 滑动
    let touchStartInfo = null;
    const TAP_MOVE_THRESHOLD = 10; // 位移阈值（px）
    const TAP_TIME_THRESHOLD = 300; // 时长阈值（ms）

    // 是否应排除当前点击目标（链接/按钮/输入/弹层打开/文字选中）
    function shouldExcludeTap(target) {
        if (!target) return true;
        const tag = target.tagName;
        if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            return true;
        }
        // 排除书架卡片、目录叶子、章末导航按钮、搜索结果、代码块等可交互/可滚动元素
        if (target.closest('a, button, input, textarea, select, pre, code, .book, .tree-leaf, .chapter-btn, .search-result-title')) {
            return true;
        }
        // 弹层打开时不翻页
        if (elements.settingsPanel && elements.settingsPanel.classList.contains('open')) return true;
        if (elements.sidebar && elements.sidebar.classList.contains('open')) return true;
        if (elements.modalOverlay && elements.modalOverlay.classList.contains('open')) return true;
        // 文字选中时不翻页
        try {
            if (window.getSelection && window.getSelection().toString()) return true;
        } catch (err) {
            // 跨域 iframe 可能抛错，忽略
        }
        return false;
    }

    // 翻页：滚动一屏的 85%
    function pageByDirection(direction) {
        if (!elements.reader) return;
        const distance = elements.reader.clientHeight * 0.85;
        const top = direction === 'prev' ? -distance : distance;
        const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        elements.reader.scrollBy({
            top: top,
            behavior: prefersReduced ? 'auto' : 'smooth'
        });
    }

    // 统一点击处理入口
    function handleReaderTap(e) {
        if (!elements.reader) return;
        // 仅阅读视图响应
        if (state.currentView !== 'reader') return;
        if (shouldExcludeTap(e.target)) return;

        const isMobile = window.innerWidth <= 768;
        const rect = elements.reader.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;

        if (isMobile) {
            // 移动端：左 25% 上一屏、中 50% 切换 UI、右 25% 下一屏
            if (x < width * 0.25) {
                pauseAutoScroll();
                pageByDirection('prev');
            } else if (x > width * 0.75) {
                pauseAutoScroll();
                pageByDirection('next');
            } else {
                document.body.classList.toggle('ui-hidden');
            }
        } else {
            // 桌面端：仅中央点击切换 UI（沿用原行为，避免破坏桌面阅读体验）
            const vh = window.innerHeight;
            const y = e.clientY;
            if (y < vh * 0.35 || y > vh * 0.65) return;
            document.body.classList.toggle('ui-hidden');
        }
    }

    function initReaderTap() {
        if (!elements.reader) return;

        // click 统一入口（桌面端主要走这里）
        elements.reader.addEventListener('click', (e) => {
            if (tapHandledByTouch) {
                // 本次点击已由 touchend 处理，跳过
                tapHandledByTouch = false;
                return;
            }
            handleReaderTap(e);
        });

        // touch 区分轻点与滑动（移动端）
        elements.reader.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) {
                touchStartInfo = null;
                return;
            }
            const t = e.touches[0];
            touchStartInfo = {
                x: t.clientX,
                y: t.clientY,
                time: Date.now()
            };
        }, { passive: true });

        elements.reader.addEventListener('touchend', (e) => {
            if (!touchStartInfo) return;
            const start = touchStartInfo;
            touchStartInfo = null;
            const t = e.changedTouches[0];
            if (!t) return;
            const dx = t.clientX - start.x;
            const dy = t.clientY - start.y;
            const moved = Math.sqrt(dx * dx + dy * dy);
            const elapsed = Date.now() - start.time;

            // 位移小且时长短视为轻点
            if (moved < TAP_MOVE_THRESHOLD && elapsed < TAP_TIME_THRESHOLD) {
                // 排除可交互元素
                if (shouldExcludeTap(e.target)) return;
                // 标记已处理，阻止后续 click 重复触发
                tapHandledByTouch = true;
                handleReaderTap(e);
            }
            // 位移超阈值视为滑动，不触发翻页，让原生滚动
        }, { passive: true });
    }

    /* ============ 番茄式自动阅读 ============ */
    let autoScrollRafId = null;
    let autoScrollLastTs = 0;
    let autoScrollPxAccumulator = 0;

    function getReaderLineHeightPx() {
        // 取 .markdown-body 的计算行高（像素值），避免取 .reader 本身的继承值
        const md = elements.reader && elements.reader.querySelector('.markdown-body');
        if (md) {
            const lh = parseFloat(getComputedStyle(md).lineHeight);
            if (!isNaN(lh) && lh > 0) return lh;
        }
        // 回退：用 CSS 变量计算
        const root = document.documentElement;
        const cs = getComputedStyle(root);
        const lhVar = parseFloat(cs.getPropertyValue('--reader-line-height'));
        const fsVar = parseFloat(cs.getPropertyValue('--reader-font-size'));
        if (!isNaN(lhVar) && !isNaN(fsVar) && lhVar > 0 && fsVar > 0) {
            return lhVar * fsVar;
        }
        return 28; // 最终回退
    }

    function autoScrollLoop(ts) {
        if (!autoScrollRafId) return;
        if (!autoScrollLastTs) autoScrollLastTs = ts;
        // clamp deltaTime，防止后台切回瞬移
        const dt = Math.min(ts - autoScrollLastTs, 100);
        autoScrollLastTs = ts;

        const reader = elements.reader;
        if (!reader) {
            pauseAutoScroll();
            return;
        }

        // 到达章节末尾自动暂停
        if (reader.scrollHeight - reader.scrollTop - reader.clientHeight < 2) {
            pauseAutoScroll();
            return;
        }

        // 速度：行/分钟 → 像素/毫秒
        const s = loadSettings();
        let speed = s.autoScrollSpeed || 50;
        // 遵守 prefers-reduced-motion：降速到最慢
        const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReduced) speed = Math.min(speed, 24);

        const lineHeightPx = getReaderLineHeightPx();
        const pxPerMs = (speed * lineHeightPx) / 60000;
        const dy = pxPerMs * dt;
        // 整数累积：亚像素 dy 累积到 >= 1px 时才 scrollBy，避免部分浏览器
        // 对 scrollBy(0, 0.xx) 取整为 0 导致速度无差异（BUG-042）
        autoScrollPxAccumulator += dy;
        if (autoScrollPxAccumulator >= 1) {
            const pxToScroll = Math.floor(autoScrollPxAccumulator);
            reader.scrollBy(0, pxToScroll);
            autoScrollPxAccumulator -= pxToScroll;
        }

        autoScrollRafId = window.requestAnimationFrame(autoScrollLoop);
    }

    function startAutoScroll() {
        if (autoScrollRafId) return;
        if (!elements.reader) return;
        if (state.currentView !== 'reader') return;
        autoScrollLastTs = 0;
        autoScrollPxAccumulator = 0;
        autoScrollRafId = window.requestAnimationFrame(autoScrollLoop);
        const s = loadSettings();
        if (!s.autoScroll) {
            s.autoScroll = true;
            saveSettings(s);
            applySettings(s);
        } else {
            updateAutoScrollBtn(true);
        }
    }

    function pauseAutoScroll() {
        if (autoScrollRafId) {
            window.cancelAnimationFrame(autoScrollRafId);
            autoScrollRafId = null;
        }
        autoScrollLastTs = 0;
        autoScrollPxAccumulator = 0;
        const s = loadSettings();
        if (s.autoScroll) {
            s.autoScroll = false;
            saveSettings(s);
            applySettings(s);
        } else {
            updateAutoScrollBtn(false);
        }
    }

    function toggleAutoScroll() {
        if (autoScrollRafId) {
            pauseAutoScroll();
        } else {
            startAutoScroll();
        }
    }

    function updateAutoScrollBtn(isPlaying) {
        if (elements.autoScrollBtns) {
            elements.autoScrollBtns.querySelectorAll('button').forEach((btn) => {
                btn.classList.toggle('active', (btn.dataset.autoScroll === 'true') === isPlaying);
            });
        }
    }

    function initAutoScroll() {
        // 手动滚动（wheel/touchmove）时暂停自动阅读
        if (elements.reader) {
            elements.reader.addEventListener('wheel', () => {
                if (autoScrollRafId) pauseAutoScroll();
            }, { passive: true });
            elements.reader.addEventListener('touchmove', () => {
                if (autoScrollRafId) pauseAutoScroll();
            }, { passive: true });
        }
    }

    /* ============ 沉浸阅读模式 ============ */
    // BUG-021 修正：重新引入 Fullscreen API 实现"整屏全屏"（隐藏浏览器地址栏/操作栏），
    // 但与 BUG-021 不同：
    //   1. 不调用 orientation 锁定 API（screen[.]orientation[.]lock，强制横屏根因）
    //   2. 小米浏览器 UA 跳过 Fullscreen API（小米 requestFullscreen 会强制横屏），仅用纯 CSS 沉浸
    //   3. Fullscreen 失败时 fallback 到纯 CSS 沉浸（保留 body class）
    function isXiaomiBrowser() {
        // 小米原生浏览器 UA 含 MiuiBrowser；红米也用同款
        return /MiuiBrowser/i.test(navigator.userAgent);
    }

    function requestBrowserFullscreen() {
        const el = document.documentElement;
        const fn = el.requestFullscreen || el.webkitRequestFullscreen;
        if (!fn) return false;
        try {
            const p = fn.call(el);
            return p && typeof p.then === 'function' ? p : Promise.resolve();
        } catch (e) {
            return Promise.reject(e);
        }
    }

    function exitBrowserFullscreen() {
        const fn = document.exitFullscreen || document.webkitExitFullscreen;
        if (!fn) return;
        try { fn.call(document); } catch (e) { /* 忽略 */ }
    }

    function enterImmersiveMode() {
        document.body.classList.add('immersive-mode');
        // 进入沉浸时隐藏 UI 工具栏，让正文占满
        document.body.classList.add('ui-hidden');
        updateImmersiveBtn(true);
        // 小米浏览器跳过 Fullscreen API，仅用纯 CSS 沉浸
        if (isXiaomiBrowser()) return;
        // 尝试整屏全屏，失败回退到纯 CSS（body class 已加，无需额外处理）
        const p = requestBrowserFullscreen();
        if (p && p.catch) {
            p.catch(function () { /* 静默 fallback 到纯 CSS 沉浸 */ });
        }
    }

    function exitImmersiveMode() {
        document.body.classList.remove('immersive-mode');
        document.body.classList.remove('ui-hidden');
        updateImmersiveBtn(false);
        // 仅当当前处于 Fullscreen 状态时才退出
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            exitBrowserFullscreen();
        }
    }

    function toggleImmersiveMode() {
        if (document.body.classList.contains('immersive-mode')) {
            exitImmersiveMode();
        } else {
            enterImmersiveMode();
        }
    }

    function updateImmersiveBtn(isActive) {
        if (!elements.immersiveBtn) return;
        elements.immersiveBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        elements.immersiveBtn.textContent = isActive ? '✕ 退出' : '⛶ 沉浸';
    }

    function initImmersive() {
        if (elements.immersiveBtn) {
            // 初始化 aria-pressed（HTML 未声明时 getAttribute 返回 null）
            elements.immersiveBtn.setAttribute('aria-pressed', 'false');
            elements.immersiveBtn.addEventListener('click', toggleImmersiveMode);
        }
    }

    /* ============ 离线下载（导出 Markdown） ============ */
    // 第一性原理：源文件已是 markdown，导出 = 抓取 + 剥 frontmatter + 标题降级 + 三级层级拼装。
    // 目录识别靠 H1(书) / H2(章) / H3(笔记) 三级，正文原有标题降级到 H4-H6 避免污染大纲。
    const EXPORT_CONCURRENCY = 6;

    // 导出时的临时状态：选中的 path 集合 + 当前选择的导出格式
    const exportState = {
        selectedPaths: new Set(),
        allPaths: [],
        exporting: false,
        format: 'md' // 'md' | 'txt' | 'epub'（由 radio 切换，performExport 按此 dispatch）
    };

    /**
     * 把 state.currentBookTree 归一化为 chapters 列表（每项 chapter 含 children=notes）。
     * currentBookTree 可能有 3 种形状：
     *  - chapters 列表（openBook 正常路径，book.tree）
     *  - [bookNode]（openBook fallback，书节点包装）
     *  - 多书树（loadTree 无 currentBook 时，死代码路径）
     * 通过检测首层节点的孙节点是否存在来区分。
     */
    function normalizeChaptersForExport(tree) {
        if (!Array.isArray(tree) || tree.length === 0) return [];
        const first = tree[0];
        const hasGrandChildren = first && Array.isArray(first.children)
            && first.children[0] && Array.isArray(first.children[0].children);
        if (hasGrandChildren) {
            // 书节点包装：取该书（单书包装）或保持多书树（多书）
            return tree.length === 1 ? (first.children || []) : tree;
        }
        return tree;
    }

    function openExportModal() {
        // 必须先打开一本书
        if (!state.currentBook || !state.currentBookTree || state.currentBookTree.length === 0) {
            if (elements.exportBookTip) {
                elements.exportBookTip.textContent = '请在书架中打开一本书后再使用离线下载。';
                elements.exportBookTip.style.display = '';
            }
            if (elements.exportTree) elements.exportTree.innerHTML = '';
            if (elements.exportConfirmBtn) elements.exportConfirmBtn.disabled = true;
            if (elements.exportSelectAllBtn) elements.exportSelectAllBtn.disabled = true;
            if (elements.exportClearBtn) elements.exportClearBtn.disabled = true;
        } else {
            if (elements.exportBookTip) {
                elements.exportBookTip.textContent = `当前书籍：${state.currentBook}（共 ${flattenTree(state.currentBookTree).length} 篇笔记）`;
                elements.exportBookTip.style.display = '';
            }
            if (elements.exportSelectAllBtn) elements.exportSelectAllBtn.disabled = false;
            if (elements.exportClearBtn) elements.exportClearBtn.disabled = false;
            renderExportTree();
        }
        resetExportProgress();
        if (elements.exportOverlay) {
            elements.exportOverlay.classList.add('open');
            elements.exportOverlay.setAttribute('aria-hidden', 'false');
        }
    }

    function closeExportModal() {
        if (exportState.exporting) return; // 导出进行中不允许关闭
        if (elements.exportOverlay) {
            elements.exportOverlay.classList.remove('open');
            elements.exportOverlay.setAttribute('aria-hidden', 'true');
        }
    }

    function resetExportProgress() {
        if (elements.exportProgress) elements.exportProgress.hidden = true;
        if (elements.exportProgressFill) elements.exportProgressFill.style.width = '0%';
        if (elements.exportProgressText) elements.exportProgressText.textContent = '准备中…';
    }

    function renderExportTree() {
        exportState.selectedPaths = new Set();
        exportState.allPaths = [];
        if (!elements.exportTree) return;
        elements.exportTree.innerHTML = '';

        // state.currentBookTree 归一化为 chapters 列表（兼容书节点包装/多书树形状）
        const chapters = normalizeChaptersForExport(state.currentBookTree || []);
        if (chapters.length === 0) {
            elements.exportTree.innerHTML = '<div class="empty-state">本书暂无笔记</div>';
            updateExportCounter();
            return;
        }

        // 渲染 chapter -> note 两级结构（书名已在 exportBookTip 显示）
        const ul = document.createElement('ul');
        ul.className = 'export-list';

        chapters.forEach((chapterNode) => {
            const chapterLi = document.createElement('li');
            chapterLi.className = 'export-node export-chapter';
            const chapterRow = document.createElement('div');
            chapterRow.className = 'export-row export-row-chapter';
            const chapterCb = document.createElement('input');
            chapterCb.type = 'checkbox';
            chapterCb.className = 'export-checkbox export-checkbox-chapter';
            chapterCb.dataset.role = 'chapter';
            const chapterLabel = document.createElement('span');
            chapterLabel.className = 'export-label';
            chapterLabel.textContent = chapterNode.title || '未命名章节';
            chapterRow.appendChild(chapterCb);
            chapterRow.appendChild(chapterLabel);
            chapterLi.appendChild(chapterRow);

            const notesUl = document.createElement('ul');
            notesUl.className = 'export-sublist';
            (chapterNode.children || []).forEach((noteNode) => {
                if (!noteNode.path) return;
                exportState.allPaths.push(noteNode.path);
                const noteLi = document.createElement('li');
                noteLi.className = 'export-node export-note';
                const noteRow = document.createElement('div');
                noteRow.className = 'export-row export-row-note';
                const noteCb = document.createElement('input');
                noteCb.type = 'checkbox';
                noteCb.className = 'export-checkbox export-checkbox-note';
                noteCb.dataset.role = 'note';
                noteCb.dataset.path = noteNode.path;
                const noteLabel = document.createElement('span');
                noteLabel.className = 'export-label';
                noteLabel.textContent = noteNode.title || noteNode.event || '未命名笔记';
                noteRow.appendChild(noteCb);
                noteRow.appendChild(noteLabel);
                noteLi.appendChild(noteRow);
                notesUl.appendChild(noteLi);

                noteCb.addEventListener('change', () => {
                    if (noteCb.checked) {
                        exportState.selectedPaths.add(noteNode.path);
                    } else {
                        exportState.selectedPaths.delete(noteNode.path);
                    }
                    syncParentCheckboxState(chapterCb);
                    updateExportCounter();
                });
            });
            chapterLi.appendChild(notesUl);

            chapterCb.addEventListener('change', () => {
                const noteCbs = notesUl.querySelectorAll('.export-checkbox-note');
                noteCbs.forEach((cb) => {
                    cb.checked = chapterCb.checked;
                    if (chapterCb.checked) {
                        exportState.selectedPaths.add(cb.dataset.path);
                    } else {
                        exportState.selectedPaths.delete(cb.dataset.path);
                    }
                });
                updateExportCounter();
            });

            ul.appendChild(chapterLi);
        });

        elements.exportTree.appendChild(ul);
        updateExportCounter();

        // BUG-048：默认展示第一章（弹窗渲染后立即把树滚动到顶部，避免残留上次位置）
        if (elements.exportTree) {
            elements.exportTree.scrollTop = 0;
        }
    }

    function syncParentCheckboxState(parentCb) {
        const parentLi = parentCb.closest('.export-node');
        if (!parentLi) return;
        const childCbs = parentLi.querySelectorAll(':scope > .export-sublist .export-checkbox-note');
        if (childCbs.length === 0) return;
        let checked = 0;
        childCbs.forEach((cb) => { if (cb.checked) checked++; });
        if (checked === 0) {
            parentCb.checked = false;
            parentCb.indeterminate = false;
        } else if (checked === childCbs.length) {
            parentCb.checked = true;
            parentCb.indeterminate = false;
        } else {
            parentCb.checked = false;
            parentCb.indeterminate = true;
        }
    }

    function updateExportCounter() {
        const count = exportState.selectedPaths.size;
        if (elements.exportCounter) {
            elements.exportCounter.textContent = `已选 ${count} 篇`;
        }
        if (elements.exportConfirmBtn) {
            elements.exportConfirmBtn.disabled = count === 0 || exportState.exporting;
        }
    }

    function selectAllExport() {
        if (exportState.exporting) return;
        exportState.allPaths.forEach((p) => exportState.selectedPaths.add(p));
        if (elements.exportTree) {
            elements.exportTree.querySelectorAll('.export-checkbox').forEach((cb) => {
                cb.checked = true;
                cb.indeterminate = false;
            });
        }
        updateExportCounter();
    }

    function clearExport() {
        if (exportState.exporting) return;
        exportState.selectedPaths.clear();
        if (elements.exportTree) {
            elements.exportTree.querySelectorAll('.export-checkbox').forEach((cb) => {
                cb.checked = false;
                cb.indeterminate = false;
            });
        }
        updateExportCounter();
    }

    /**
     * 正文标题降级：把正文里已有的 ATX 标题（#~######）整体下移 3 级，
     * 保证导出文档大纲唯一由「书H1 / 章H2 / 笔记H3」三层构成，
     * 让 Obsidian/Typora/VSCode 的目录识别稳定可控。
     * Setext 标题（下一行 ===/---）也一并转成降级后的 ATX。
     *
     * 代码块（三反引号或三波浪号围栏）内的内容不降级，避免污染代码注释/字符串里的井号。
     */
    function downgradeHeadings(body) {
        // 按围栏代码块分段：偶数段为代码块（不处理），奇数段为正文（降级）
        const segments = body.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
        return segments.map((seg, idx) => {
            // 围栏代码块本身（idx 为奇数）原样返回
            if (idx % 2 === 1) return seg;
            let out = seg;
            // 1) Setext H1（===）→ ATX 降 3 级 = ####
            out = out.replace(/^(.+)[ \t]*\n=+[ \t]*$/gm, (m, title) => '#### ' + title.trim());
            // 2) Setext H2（---）→ ATX 降 3 级 = #####
            out = out.replace(/^(.+)[ \t]*\n-+[ \t]*$/gm, (m, title) => '##### ' + title.trim());
            // 3) ATX 标题整体降 3 级，超过 6 级截断到 6 级
            out = out.replace(/^(#{1,6})\s+/gm, (m, hashes) => {
                const newLevel = Math.min(hashes.length + 3, 6);
                return '#'.repeat(newLevel) + ' ';
            });
            return out;
        }).join('');
    }

    async function fetchNoteRaw(path) {
        return await fetchJson('notes/' + encodeURI(path));
    }

    /**
     * 限流并发抓取，避免一次拉几十个文件压垮静态服务器或浏览器连接池。
     */
    async function fetchAllWithConcurrency(paths, onProgress) {
        const results = new Map();
        let index = 0;
        let done = 0;
        const total = paths.length;
        async function worker() {
            while (index < paths.length) {
                const current = paths[index++];
                try {
                    const text = await fetchNoteRaw(current);
                    results.set(current, text || '');
                } catch (err) {
                    // 单篇失败不阻断整体导出，写入错误占位（用引用块而非 H1，避免污染大纲）
                    results.set(current, `> ⚠️ 本篇笔记加载失败：${err && err.message ? err.message : '网络错误'}（路径：${current}）\n`);
                }
                done++;
                if (onProgress) onProgress(done, total);
            }
        }
        const workers = [];
        for (let i = 0; i < Math.min(EXPORT_CONCURRENCY, paths.length); i++) {
            workers.push(worker());
        }
        await Promise.all(workers);
        return results;
    }

    /**
     * 按章→笔记顺序拼装单个 md。
     * 顶部生成可点击目录，每个条目锚点 = 笔记标题 slug。
     * selectedChapters 是 state.currentBookTree 的子集（chapters 列表）。
     *
     * 锚点一致性：先一次性扫描建立 path→anchor 映射，TOC 与正文都查表，
     * 避免 slugify 双调用导致 TOC 链接与正文锚点错位。
     */
    function assembleMarkdown(bookTitle, selectedChapters, rawMap) {
        const lines = [];
        lines.push(`# ${bookTitle}`);
        lines.push('');
        lines.push(`> 由豪书斋阅读器离线导出 · ${new Date().toLocaleString('zh-CN')}`);
        lines.push('');

        // 1) 一次性建立 path → anchor 映射（去重发生在这一步，TOC/正文仅查表）
        const anchorMap = new Map();
        const anchorSet = new Set();
        const slugify = (text) => {
            // 兼容主流本地阅读器锚点：保留中文/字母/数字/连字符，其余转 -
            const slug = String(text || '')
                .trim()
                .toLowerCase()
                .replace(/[\s<>{}\[\]|\\^`*#+!$%&=()~,，。、；：""''！？·—…]+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
            let base = slug || 'note';
            let final = base;
            let n = 2;
            while (anchorSet.has(final)) {
                final = `${base}-${n++}`;
            }
            anchorSet.add(final);
            return final;
        };
        selectedChapters.forEach((chapterNode) => {
            (chapterNode.children || []).forEach((noteNode) => {
                if (!noteNode.path || !rawMap.has(noteNode.path)) return;
                const noteTitle = noteNode.title || noteNode.event || '未命名笔记';
                anchorMap.set(noteNode.path, slugify(noteTitle));
            });
        });

        // 2) 顶部目录
        const tocLines = [];
        tocLines.push('## 目录');
        tocLines.push('');
        selectedChapters.forEach((chapterNode) => {
            (chapterNode.children || []).forEach((noteNode) => {
                if (!noteNode.path || !rawMap.has(noteNode.path)) return;
                const noteTitle = noteNode.title || noteNode.event || '未命名笔记';
                const anchor = anchorMap.get(noteNode.path);
                tocLines.push(`- [${noteTitle}](#${anchor})`);
            });
        });
        lines.push(...tocLines);
        lines.push('');
        lines.push('---');
        lines.push('');

        // 3) 正文
        selectedChapters.forEach((chapterNode) => {
            const chapterNotes = (chapterNode.children || []).filter((n) => n.path && rawMap.has(n.path));
            if (chapterNotes.length === 0) return;
            lines.push(`## ${chapterNode.title || '未命名章节'}`);
            lines.push('');
            chapterNotes.forEach((noteNode) => {
                const raw = rawMap.get(noteNode.path) || '';
                const { body } = parseFrontmatter(raw);
                const noteTitle = noteNode.title || noteNode.event || '未命名笔记';
                const anchor = anchorMap.get(noteNode.path);
                lines.push(`<a id="${anchor}"></a>`);
                lines.push(`### ${noteTitle}`);
                lines.push('');
                lines.push(downgradeHeadings(body.replace(/\s+$/, '')));
                lines.push('');
                lines.push('---');
                lines.push('');
            });
        });

        return lines.join('\n');
    }

    function triggerDownload(filename, content, mimeType) {
        // mimeType 参数化：md/txt 用 text/*，epub 用 application/epub+zip
        // 默认仍为 markdown，保证旧调用点（不传第三参）行为不变
        // content 可以是 string 或 Blob（epub 已是 Blob，避免二次包装）
        const type = mimeType || 'text/markdown;charset=utf-8';
        const blob = (content instanceof Blob) ? content : new Blob([content], { type: type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        // 释放时机：click 触发后浏览器仍需异步读取 Blob（移动端可能弹下载确认），
        // 延后到下一个宏任务再 revoke，既避免过早释放导致下载空文件，又尽快回收内存。
        setTimeout(() => {
            URL.revokeObjectURL(url);
            if (a.parentNode) a.parentNode.removeChild(a);
        }, 0);
    }

    /**
     * BUG-049：TXT 导出。目标场景 = 导出到听书软件，TTS 引擎朗读。
     * 设计原则：
     *  1) 完全去除 markdown 语法（井号/星号/反引号/大于号/连字符等），只留纯文本，避免 TTS 把符号读出来
     *  2) 章节标题用「第 X 章 标题」前缀 + 空行分隔，听书软件易识别
     *  3) 笔记标题前加全角空行 + 「■ 」标记，让朗读引擎自然停顿
     *  4) 剥 frontmatter，去掉所有 HTML 标签和代码围栏
     */
    function assembleTxt(bookTitle, selectedChapters, rawMap) {
        const lines = [];
        lines.push(bookTitle);
        lines.push('由豪书斋阅读器离线导出 · ' + new Date().toLocaleString('zh-CN'));
        lines.push('');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('');

        const stripMarkdown = (text) => {
            let out = text;
            // 剥围栏代码块（三反引号或三波浪号），保留代码内容但去掉围栏
            out = out.replace(/```[\w-]*\n([\s\S]*?)```/g, '$1');
            out = out.replace(/~~~[\w-]*\n([\s\S]*?)~~~/g, '$1');
            // 剥行内代码反引号
            out = out.replace(/`([^`]+)`/g, '$1');
            // 剥 HTML 标签
            out = out.replace(/<[^>]+>/g, '');
            // 剥 ATX 标题的井号（保留标题文字）
            out = out.replace(/^#{1,6}\s+/gm, '');
            // 剥 Setext 标题的下划线（等号/连字符）
            out = out.replace(/\n=+\s*$/g, '');
            out = out.replace(/\n-+\s*$/g, '');
            // 剥引用符号大于号
            out = out.replace(/^>\s?/gm, '');
            // 剥无序列表符号（连字符/星号/加号 开头）
            out = out.replace(/^[\s]*[-*+]\s+/gm, '');
            // 剥有序列表符号 数字加点
            out = out.replace(/^[\s]*\d+\.\s+/gm, '');
            // 剥粗体 / 斜体
            out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
            out = out.replace(/__([^_]+)__/g, '$1');
            out = out.replace(/\*([^*]+)\*/g, '$1');
            out = out.replace(/_([^_]+)_/g, '$1');
            // 剥图片和链接，保留文本
            out = out.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
            out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
            // 水平分隔线（三连字符或三星号）替换为长破折号
            out = out.replace(/^[\s]*([-*]){3,}\s*$/gm, '────────────────');
            // 折叠多余空行（连续 3+ 空行 → 2 空行）
            out = out.replace(/\n{3,}/g, '\n\n');
            return out;
        };

        selectedChapters.forEach((chapterNode, chIdx) => {
            const chapterNotes = (chapterNode.children || []).filter((n) => n.path && rawMap.has(n.path));
            if (chapterNotes.length === 0) return;
            lines.push(`第 ${chIdx + 1} 章 · ${chapterNode.title || '未命名章节'}`);
            lines.push('');
            chapterNotes.forEach((noteNode, nIdx) => {
                const raw = rawMap.get(noteNode.path) || '';
                const { body } = parseFrontmatter(raw);
                const noteTitle = noteNode.title || noteNode.event || '未命名笔记';
                lines.push(`■ ${noteTitle}`);
                lines.push('');
                lines.push(stripMarkdown(body.replace(/\s+$/, '')));
                lines.push('');
                lines.push('────────────────');
                lines.push('');
            });
        });

        return lines.join('\n');
    }

    /**
     * BUG-049：EPUB 导出。目标场景 = 导出到听书软件 / 阅读器，支持章节跳转。
     * EPUB 本质是带约定目录结构的 ZIP 包（OCF + OPS）。
     * 实现：
     *  1) mimetype 文件必须存在且为 zip 中第一个文件、不压缩
     *  2) META-INF/container.xml 指向 OEBPS/content.opf
     *  3) OEBPS/content.opf 含 metadata / manifest / spine
     *  4) OEBPS/toc.ncx 含 navMap 章节导航
     *  5) 每篇笔记一个 xhtml 文件
     *  6) 用 marked 把 markdown 转 HTML 后包裹 XHTML 骨架
     *  7) JSZip 走本地 vendor 兜底（与 marked.js 同机制），首次调用时动态注入 script
     */
    let jszipPromise = null;
    function loadJSZip() {
        if (jszipPromise) return jszipPromise;
        if (typeof window !== 'undefined' && window.JSZip) {
            jszipPromise = Promise.resolve(window.JSZip);
            return jszipPromise;
        }
        jszipPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'js/vendor/jszip.min.js?v=2026070602';
            script.onload = () => {
                if (window.JSZip) resolve(window.JSZip);
                else reject(new Error('JSZip 加载完成但未挂到 window'));
            };
            script.onerror = () => reject(new Error('JSZip 本地副本加载失败，请检查网络或 js/vendor/jszip.min.js'));
            document.head.appendChild(script);
        });
        return jszipPromise;
    }

    function escapeXml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function mdBodyToXhtml(body) {
        // marked 已在全局可用（阅读器渲染时已加载）
        const html = (typeof marked !== 'undefined' && marked.parse)
            ? marked.parse(body, { breaks: false, gfm: true })
            : '<pre>' + escapeXml(body) + '</pre>';
        return html;
    }

    async function assembleEpub(bookTitle, selectedChapters, rawMap) {
        const JSZip = await loadJSZip();
        const zip = new JSZip();

        // 1) mimetype（必须首位、不压缩）
        zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

        // 2) META-INF/container.xml
        zip.file('META-INF/container.xml',
            '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
            '  <rootfiles>\n' +
            '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n' +
            '  </rootfiles>\n' +
            '</container>\n'
        );

        // 3) 收集所有笔记，生成 xhtml 文件 + 构建 manifest / spine / navMap
        const bookId = 'halo-' + Date.now();
        const items = []; // {id, href, title, chapterTitle}
        let noteIdx = 0;
        selectedChapters.forEach((chapterNode, chIdx) => {
            const chapterNotes = (chapterNode.children || []).filter((n) => n.path && rawMap.has(n.path));
            chapterNotes.forEach((noteNode, nIdx) => {
                const raw = rawMap.get(noteNode.path) || '';
                const { body } = parseFrontmatter(raw);
                const noteTitle = noteNode.title || noteNode.event || '未命名笔记';
                const chapterTitle = chapterNode.title || '未命名章节';
                const id = 'note-' + (noteIdx + 1);
                const href = 'content/note-' + (noteIdx + 1) + '.xhtml';

                const xhtml =
                    '<?xml version="1.0" encoding="UTF-8"?>\n' +
                    '<!DOCTYPE html>\n' +
                    '<html xmlns="http://www.w3.org/1999/xhtml">\n' +
                    '<head>\n' +
                    '  <meta charset="utf-8"/>\n' +
                    '  <title>' + escapeXml(noteTitle) + '</title>\n' +
                    '  <link rel="stylesheet" type="text/css" href="../style.css"/>\n' +
                    '</head>\n' +
                    '<body>\n' +
                    '  <h1>' + escapeXml(noteTitle) + '</h1>\n' +
                    '  <p class="chapter-context">第 ' + (chIdx + 1) + ' 章 · ' + escapeXml(chapterTitle) + '</p>\n' +
                    mdBodyToXhtml(body) + '\n' +
                    '</body>\n' +
                    '</html>\n';
                zip.file('OEBPS/' + href, xhtml);
                items.push({ id: id, href: href, title: noteTitle, chapterTitle: chapterTitle });
                noteIdx++;
            });
        });

        if (items.length === 0) {
            // 兜底：空 EPUB 也至少要有 1 个 spine 项
            const id = 'note-empty';
            const href = 'content/note-empty.xhtml';
            zip.file('OEBPS/' + href,
                '<?xml version="1.0" encoding="UTF-8"?>\n' +
                '<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml">\n<head><meta charset="utf-8"/><title>空</title></head>\n<body><p>本书暂无笔记</p></body>\n</html>\n'
            );
            items.push({ id: id, href: href, title: '空', chapterTitle: '空' });
        }

        // 4) OEBPS/style.css
        zip.file('OEBPS/style.css',
            'body { font-family: serif; line-height: 1.8; margin: 1em; }\n' +
            'h1 { font-size: 1.4em; border-bottom: 1px solid #ccc; padding-bottom: 0.3em; }\n' +
            '.chapter-context { color: #888; font-size: 0.85em; margin-top: -0.5em; }\n' +
            'blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #aaa; color: #555; }\n' +
            'pre { background: #f6f6f6; padding: 0.8em; overflow-x: auto; font-size: 0.9em; }\n' +
            'code { background: #f6f6f6; padding: 0.1em 0.3em; }\n'
        );

        // 5) OEBPS/content.opf
        const manifestItems = items.map((it) =>
            '    <item id="' + escapeXml(it.id) + '" href="' + escapeXml(it.href) + '" media-type="application/xhtml+xml"/>'
        ).join('\n');
        const spineItems = items.map((it) =>
            '    <itemref idref="' + escapeXml(it.id) + '"/>'
        ).join('\n');
        zip.file('OEBPS/content.opf',
            '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">\n' +
            '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">\n' +
            '    <dc:title>' + escapeXml(bookTitle) + '</dc:title>\n' +
            '    <dc:creator>豪书斋</dc:creator>\n' +
            '    <dc:language>zh-CN</dc:language>\n' +
            '    <dc:identifier id="bookid">' + bookId + '</dc:identifier>\n' +
            '    <dc:date>' + new Date().toISOString().slice(0, 10) + '</dc:date>\n' +
            '  </metadata>\n' +
            '  <manifest>\n' +
            '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n' +
            '    <item id="css" href="style.css" media-type="text/css"/>\n' +
            manifestItems + '\n' +
            '  </manifest>\n' +
            '  <spine toc="ncx">\n' + spineItems + '\n  </spine>\n' +
            '</package>\n'
        );

        // 6) OEBPS/toc.ncx
        const navPoints = items.map((it, idx) =>
            '    <navPoint id="nav-' + (idx + 1) + '" playOrder="' + (idx + 1) + '">\n' +
            '      <navLabel><text>' + escapeXml(it.title) + '</text></navLabel>\n' +
            '      <content src="' + escapeXml(it.href) + '"/>\n' +
            '    </navPoint>'
        ).join('\n');
        zip.file('OEBPS/toc.ncx',
            '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">\n' +
            '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n' +
            '  <head>\n' +
            '    <meta name="dtb:uid" content="' + bookId + '"/>\n' +
            '    <meta name="dtb:depth" content="1"/>\n' +
            '    <meta name="dtb:totalPageCount" content="' + items.length + '"/>\n' +
            '    <meta name="dtb:maxPageNumber" content="' + items.length + '"/>\n' +
            '  </head>\n' +
            '  <docTitle><text>' + escapeXml(bookTitle) + '</text></docTitle>\n' +
            '  <navMap>\n' + navPoints + '\n  </navMap>\n' +
            '</ncx>\n'
        );

        // 7) 生成 Blob
        const blob = await zip.generateAsync({
            type: 'blob',
            mimeType: 'application/epub+zip',
            compression: 'DEFLATE'
        });
        return blob;
    }

    /**
     * 导出格式注册表：每种格式注册 assemble / extension / mimeType 三个字段。
     * - assemble(bookTitle, selectedChapters, rawMap) -> string | Blob | Promise<string|Blob>
     * - extension: 文件扩展名（不含点）
     * - mimeType: Blob 类型
     * 新增格式只需在此追加一项，performExport 自动 dispatch。
     */
    const EXPORT_FORMATTERS = {
        md: {
            assemble: assembleMarkdown,
            extension: 'md',
            mimeType: 'text/markdown;charset=utf-8'
        },
        txt: {
            assemble: assembleTxt,
            extension: 'txt',
            mimeType: 'text/plain;charset=utf-8'
        },
        epub: {
            assemble: assembleEpub,
            extension: 'epub',
            mimeType: 'application/epub+zip'
        }
    };

    function sanitizeFilename(name) {
        return String(name || 'export')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80) || 'export';
    }

    async function performExport() {
        if (exportState.exporting) return;
        const selected = Array.from(exportState.selectedPaths);
        if (selected.length === 0) return;

        exportState.exporting = true;
        if (elements.exportConfirmBtn) elements.exportConfirmBtn.disabled = true;
        if (elements.exportSelectAllBtn) elements.exportSelectAllBtn.disabled = true;
        if (elements.exportClearBtn) elements.exportClearBtn.disabled = true;
        if (elements.exportCancelBtn) elements.exportCancelBtn.textContent = '关闭';
        if (elements.exportProgress) elements.exportProgress.hidden = false;
        if (elements.exportProgressFill) elements.exportProgressFill.style.width = '0%';
        if (elements.exportProgressText) elements.exportProgressText.textContent = `正在抓取笔记 0/${selected.length}…`;

        try {
            const rawMap = await fetchAllWithConcurrency(selected, (done, total) => {
                if (elements.exportProgressFill) {
                    const pct = Math.round((done / total) * 80);
                    elements.exportProgressFill.style.width = pct + '%';
                }
                if (elements.exportProgressText) {
                    elements.exportProgressText.textContent = `正在抓取笔记 ${done}/${total}…`;
                }
            });
            if (elements.exportProgressText) {
                const fmtLabel = exportState.format === 'epub' ? 'EPUB' : (exportState.format === 'txt' ? 'TXT' : 'Markdown');
                elements.exportProgressText.textContent = `正在拼装${fmtLabel}文档…`;
            }
            if (elements.exportProgressFill) elements.exportProgressFill.style.width = '90%';
            // 让进度文本有机会渲染，避免大书同步拼装时 UI 假死
            // 用 setTimeout(0) 而非 rAF：浏览器下两者都能让出一帧让 UI 渲染，
            // 但 setTimeout 不依赖 rAF polyfill，测试环境（jsdom）也能自动推进。
            await new Promise((r) => setTimeout(r, 0));

            // 只保留被选中的章节/笔记子树（用归一化后的 chapters + 入口快照，防御 await 期间 state 变化）
            const selectedSet = new Set(selected);
            const bookTreeSnapshot = normalizeChaptersForExport(state.currentBookTree || []);
            const selectedChapters = bookTreeSnapshot.map((chapterNode) => {
                const newNotes = (chapterNode.children || []).filter((n) => n.path && selectedSet.has(n.path));
                return Object.assign({}, chapterNode, { children: newNotes });
            }).filter((ch) => ch.children.length > 0);

            const formatter = EXPORT_FORMATTERS[exportState.format] || EXPORT_FORMATTERS.md;
            const output = await formatter.assemble(state.currentBook || '豪书斋', selectedChapters, rawMap);
            const filename = sanitizeFilename(state.currentBook || 'export') + '.' + formatter.extension;
            triggerDownload(filename, output, formatter.mimeType);

            if (elements.exportProgressFill) elements.exportProgressFill.style.width = '100%';
            if (elements.exportProgressText) elements.exportProgressText.textContent = `导出完成，共 ${selected.length} 篇笔记 → ${filename}`;
        } catch (err) {
            if (elements.exportProgressText) elements.exportProgressText.textContent = '导出失败：' + (err && err.message ? err.message : '未知错误');
            console.error('[豪书斋] 离线导出失败', err);
        } finally {
            exportState.exporting = false;
            if (elements.exportConfirmBtn) elements.exportConfirmBtn.disabled = exportState.selectedPaths.size === 0;
            if (elements.exportSelectAllBtn) elements.exportSelectAllBtn.disabled = false;
            if (elements.exportClearBtn) elements.exportClearBtn.disabled = false;
            if (elements.exportCancelBtn) elements.exportCancelBtn.textContent = '取消';
        }
    }

    function initOfflineExport() {
        if (elements.offlineExportBtn) {
            elements.offlineExportBtn.addEventListener('click', openExportModal);
        }
        if (elements.exportClose) {
            elements.exportClose.addEventListener('click', closeExportModal);
        }
        if (elements.exportCancelBtn) {
            elements.exportCancelBtn.addEventListener('click', closeExportModal);
        }
        if (elements.exportOverlay) {
            elements.exportOverlay.addEventListener('click', (event) => {
                if (event.target === elements.exportOverlay) closeExportModal();
            });
        }
        if (elements.exportSelectAllBtn) {
            elements.exportSelectAllBtn.addEventListener('click', selectAllExport);
        }
        if (elements.exportClearBtn) {
            elements.exportClearBtn.addEventListener('click', clearExport);
        }
        if (elements.exportConfirmBtn) {
            elements.exportConfirmBtn.addEventListener('click', performExport);
        }
        // BUG-049：格式选择 radio 绑定
        if (elements.exportOverlay) {
            const radios = elements.exportOverlay.querySelectorAll('input[name="exportFormat"]');
            radios.forEach((radio) => {
                radio.addEventListener('change', () => {
                    if (radio.checked) exportState.format = radio.value;
                });
            });
            // 弹窗打开时重置为 md（避免上次选择残留）
            elements.exportOverlay.addEventListener('toggle', () => {
                if (elements.exportOverlay.classList.contains('open')) {
                    exportState.format = 'md';
                    radios.forEach((r) => { r.checked = (r.value === 'md'); });
                }
            });
        }
    }

    /* ============ 弹窗（静态站点提示） ============ */
    function openModal() {
        elements.modalOverlay.classList.add('open');
        elements.modalOverlay.setAttribute('aria-hidden', 'false');
    }

    function closeModal() {
        elements.modalOverlay.classList.remove('open');
        elements.modalOverlay.setAttribute('aria-hidden', 'true');
    }

    function scrollToBookshelf() {
        const bookshelf = document.getElementById('bookshelf');
        if (bookshelf) {
            bookshelf.scrollIntoView({ behavior: 'smooth' });
        }
    }

    /* ============ 树内搜索 ============ */
    function handleTreeSearch(event) {
        state.searchQuery = event.target.value.trim().toLowerCase();
        if (state.searchQuery) {
            state.searchMode = false;
        }
        refreshTreeView();
    }

    async function handleTreeSearchEnter(event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const query = elements.searchInput.value.trim();
        if (!query) {
            state.searchMode = false;
            refreshTreeView();
            return;
        }

        elements.treeNav.innerHTML = '<div class="empty-state">正在加载搜索结果…</div>';
        try {
            const searchNotes = await ensureSearchIndex();
            const results = [];
            const queryLower = query.toLowerCase();

            for (const note of searchNotes) {
                const title = note.title || note.event || '';
                const snippet = note.snippet || '';
                const titleLower = title.toLowerCase();
                const snippetLower = snippet.toLowerCase();

                let matched = false;
                let displaySnippet = snippet.slice(0, 100);
                if (snippet.length > 100) displaySnippet += '…';

                if (titleLower.includes(queryLower)) {
                    matched = true;
                } else if (snippetLower.includes(queryLower)) {
                    matched = true;
                    const idx = snippetLower.indexOf(queryLower);
                    const start = Math.max(0, idx - 30);
                    const end = Math.min(snippet.length, idx + query.length + 60);
                    displaySnippet = snippet.slice(start, end);
                    if (start > 0) displaySnippet = '…' + displaySnippet;
                    if (end < snippet.length) displaySnippet += '…';
                }

                if (matched) {
                    results.push({
                        path: note.path,
                        book: note.book,
                        chapter: note.chapter,
                        event: note.event,
                        title: title,
                        snippet: displaySnippet
                    });
                }
            }
            state.searchMode = true;
            renderSearchResults(results, query);
        } catch (err) {
            elements.treeNav.innerHTML = '<div class="empty-state">搜索索引加载失败</div>';
            showError('无法加载搜索索引，请检查 data/search-index.json 是否存在。', err);
        }
    }

    function renderSearchResults(results, query) {
        elements.treeNav.innerHTML = '';
        if (results.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = `未找到与「${query}」相关的笔记`;
            elements.treeNav.appendChild(empty);
            return;
        }
        const header = document.createElement('div');
        header.className = 'search-results-header';
        header.textContent = `找到 ${results.length} 条结果`;
        elements.treeNav.appendChild(header);

        const list = document.createElement('ul');
        list.className = 'search-results';
        results.forEach((item) => {
            const li = document.createElement('li');
            li.className = 'search-result-item';

            const title = document.createElement('button');
            title.className = 'search-result-title';
            title.type = 'button';
            title.textContent = item.title || item.path;
            title.addEventListener('click', () => {
                loadNote(item.path);
                closeSidebar();
            });
            li.appendChild(title);

            if (item.book || item.chapter) {
                const meta = document.createElement('div');
                meta.className = 'search-result-meta';
                meta.textContent = [item.book, item.chapter].filter(Boolean).join(' / ');
                li.appendChild(meta);
            }

            if (item.snippet) {
                const snippet = document.createElement('div');
                snippet.className = 'search-result-snippet';
                snippet.textContent = item.snippet;
                li.appendChild(snippet);
            }

            list.appendChild(li);
        });
        elements.treeNav.appendChild(list);
    }

    function handleKeyDown(event) {
        if (event.key === 'Escape') {
            if (elements.exportOverlay && elements.exportOverlay.classList.contains('open')) {
                closeExportModal();
            } else if (elements.settingsPanel && elements.settingsPanel.classList.contains('open')) {
                closeSettings();
            } else if (elements.modalOverlay && elements.modalOverlay.classList.contains('open')) {
                closeModal();
            } else if (elements.sidebar && elements.sidebar.classList.contains('open')) {
                closeSidebar();
            }
        }
        if (state.activePath) {
            if (event.key === 'ArrowLeft' && elements.prevBtnBottom && !elements.prevBtnBottom.disabled) {
                goPrevChapter();
            } else if (event.key === 'ArrowRight' && elements.nextBtnBottom && !elements.nextBtnBottom.disabled) {
                goNextChapter();
            } else if (state.currentView === 'reader' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                // 桌面端键盘翻页（一屏 85%）
                if (window.innerWidth > 768) {
                    event.preventDefault();
                    pauseAutoScroll();
                    pageByDirection(event.key === 'ArrowUp' ? 'prev' : 'next');
                }
            } else if (state.currentView === 'reader' && event.key === ' ') {
                // 空格键切换自动阅读播放/暂停
                event.preventDefault();
                toggleAutoScroll();
            }
        }
    }

    function detectModelScopeEmbed() {
        // 检测是否被嵌入魔搭创空间 iframe，启用嵌入适配 UI
        let inIframe = false;
        try {
            inIframe = window.self !== window.top;
        } catch (e) {
            inIframe = true;
        }

        const referrer = document.referrer || '';
        const urlParams = new URLSearchParams(window.location.search);
        const isModelScope = referrer.includes('modelscope.cn') ||
                             referrer.includes('modelscope.aliyuncs.com') ||
                             window.location.hostname.includes('.ms.show') ||
                             urlParams.get('embed') === '1' ||
                             urlParams.get('minimal') === '1';

        if (inIframe && isModelScope) {
            document.body.classList.add('modelscope-embedded');
            // 沉浸按钮显隐统一由 switchView 管理（阅读视图显示，首页隐藏）
            requestModelScopeMinimalChrome();
        }
    }

    function requestModelScopeMinimalChrome() {
        const targets = ['https://www.modelscope.cn', 'https://modelscope.cn'];
        const messages = [
            { type: 'ms:studio:hideChrome', value: true },
            { type: 'ms:studio:requestMinimal', value: true },
            { type: 'modelscope:hideHeader', value: true },
            { type: 'hideHeader', value: true }
        ];
        targets.forEach(target => {
            messages.forEach(msg => {
                try {
                    window.parent.postMessage(msg, target);
                } catch (e) {
                    // 跨域或父页面未监听时静默失败
                }
            });
        });
    }

    function resetViewState() {
        // 防止从 bfcache 恢复或异常退出后，DOM 仍保留沉浸/阅读状态导致白屏
        document.body.classList.remove('immersive-mode', 'ui-hidden');
        document.body.dataset.view = 'home';
        document.body.style.overflow = '';
        // bfcache 恢复兜底：若仍处于整屏全屏状态，一并退出
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            exitBrowserFullscreen();
        }
    }

    function init() {
        resetViewState();

        if (typeof marked === 'undefined') {
            elements.reader.innerHTML = '<div class="reader-placeholder">Markdown 渲染组件加载失败，请检查网络连接。</div>';
            console.error('marked.js is not loaded');
        }

        detectModelScopeEmbed();
        initSettings();
        initSidebarDrawer();
        initReaderTap();
        initAutoScroll();
        initImmersive();
        initOfflineExport();

        if (elements.bookshelfSearchInput) {
            elements.bookshelfSearchInput.addEventListener('input', handleBookshelfSearch);
        }
        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', handleTreeSearch);
            elements.searchInput.addEventListener('keydown', handleTreeSearchEnter);
        }
        if (elements.newNoteBtn) {
            elements.newNoteBtn.addEventListener('click', scrollToBookshelf);
        }
        if (elements.newNoteLink) {
            elements.newNoteLink.addEventListener('click', (event) => {
                event.preventDefault();
                scrollToBookshelf();
            });
        }
        if (elements.newNoteBtnToolbar) {
            elements.newNoteBtnToolbar.addEventListener('click', openModal);
        }
        if (elements.backBtn) {
            elements.backBtn.addEventListener('click', backToHome);
        }
        if (elements.brandLockup) {
            elements.brandLockup.addEventListener('click', backToHome);
        }
        if (elements.refreshBtn) {
            elements.refreshBtn.addEventListener('click', async () => {
                await loadIndex();
                if (state.currentBook) {
                    refreshTreeView();
                }
            });
        }
        if (elements.modalClose) {
            elements.modalClose.addEventListener('click', closeModal);
        }
        if (elements.cancelBtn) {
            elements.cancelBtn.addEventListener('click', closeModal);
        }
        if (elements.modalOverlay) {
            elements.modalOverlay.addEventListener('click', (event) => {
                if (event.target === elements.modalOverlay) {
                    closeModal();
                }
            });
        }

        if (elements.prevBtnBottom) {
            elements.prevBtnBottom.addEventListener('click', goPrevChapter);
        }
        if (elements.nextBtnBottom) {
            elements.nextBtnBottom.addEventListener('click', goNextChapter);
        }

        document.addEventListener('keydown', handleKeyDown);
        var resizeTimer;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimer);
        });

        // 从 bfcache 恢复时（如手机系统返回后再进），强制重置视图状态，避免白屏
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) {
                resetViewState();
                // 重新加载书架数据，确保 state 与 DOM 一致
                loadIndex();
                if (state.currentBook) {
                    state.currentBook = null;
                    state.currentBookTree = [];
                    state.activePath = null;
                }
            }
        });

        loadIndex();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
