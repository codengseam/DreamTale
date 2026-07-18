/**
 * 站点核心功能端到端测试（基于 jsdom + 本地 fetch mock）
 * 验证：index.json 精简、书架渲染、阅读视图、搜索、缓存逻辑
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { TextEncoder, TextDecoder } = require('util');

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const SITE_DIR = path.resolve(__dirname, '../site');
const INDEX_JSON = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data/index.json'), 'utf-8'));
const SEARCH_JSON = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'data/search-index.json'), 'utf-8'));

function readNote(relPath) {
    return fs.readFileSync(path.join(SITE_DIR, 'notes', relPath), 'utf-8');
}

async function runTest() {
    const html = fs.readFileSync(path.join(SITE_DIR, 'index.html'), 'utf-8');

    const dom = new JSDOM(html, {
        url: 'http://localhost:8080/',
        runScripts: 'dangerously',
        resources: 'usable',
        pretendToBeVisual: true,
        storageQuota: 100 * 1024 * 1024,
    });

    const { window } = dom;
    const { document } = window;

    // 注入 fetch mock
    window.fetch = async (url, options) => {
        const u = new URL(url, window.location.href);
        const pathname = u.pathname.replace(/^\/HaloRead\//, '/'); // 兼容子路径部署
        let body;
        let contentType = 'application/json';

        if (pathname.endsWith('/data/index.json')) {
            body = JSON.stringify(INDEX_JSON);
        } else if (pathname.endsWith('/data/search-index.json')) {
            body = JSON.stringify(SEARCH_JSON);
        } else if (pathname.includes('/notes/') && pathname.endsWith('.md')) {
            contentType = 'text/markdown';
            const relPath = decodeURI(pathname.replace(/^.*\/notes\//, ''));
            body = readNote(relPath);
        } else {
            throw new Error('未 mock 的请求: ' + url);
        }

        // jsdom 没有 window.Response，返回类 Response 对象
        return Promise.resolve({
            ok: true,
            status: 200,
            headers: {
                get: (name) => {
                    if (name.toLowerCase() === 'content-type') return contentType;
                    return null;
                }
            },
            json: async () => JSON.parse(body),
            text: async () => body,
            clone: function () { return this; }
        });
    };

    // jsdom 补丁
    window.CSS = window.CSS || { escape: (s) => String(s).replace(/"/g, '\\"') };
    window.marked = require('marked');

    // 注入 app.js
    const appCode = fs.readFileSync(path.join(SITE_DIR, 'js/app.js'), 'utf-8');
    const appScript = document.createElement('script');
    appScript.textContent = appCode;
    document.head.appendChild(appScript);

    // 等待书架渲染
    await waitFor(() => {
        const cards = document.querySelectorAll('.bookshelf-grid .book-card');
        return cards.length > 0;
    }, 2000);

    const cards = document.querySelectorAll('.bookshelf-grid .book-card');
    console.log('书架书籍数量:', cards.length);
    if (cards.length === 0) throw new Error('书架没有渲染');

    // 验证 index.json 没有 content
    if (INDEX_JSON.notes) {
        throw new Error('index.json 仍包含 notes 字段，未瘦身');
    }
    console.log('index.json 已瘦身，无 notes.content');

    // 点击第一本书
    const firstCard = cards[0];
    const bookTitle = firstCard.querySelector('.book-title').textContent;
    console.log('点击书籍:', bookTitle);
    firstCard.click();

    await waitFor(() => {
        const leaves = document.querySelectorAll('.reader-view .tree-leaf');
        return leaves.length > 0;
    }, 2000);

    const leaves = document.querySelectorAll('.reader-view .tree-leaf');
    console.log('目录叶子节点:', leaves.length);
    if (leaves.length === 0) throw new Error('目录没有渲染');

    // 点击第一篇笔记
    leaves[0].click();
    await waitFor(() => {
        return document.querySelector('.markdown-body');
    }, 2000);

    const mdBody = document.querySelector('.markdown-body');
    if (!mdBody || mdBody.textContent.length < 50) {
        throw new Error('笔记内容没有渲染');
    }
    console.log('笔记内容长度:', mdBody.textContent.length);

    // 返回书架
    document.getElementById('backBtn').click();
    await waitFor(() => {
        return document.querySelector('.bookshelf-grid .book-card');
    }, 1000);

    // 重新进入阅读视图测试搜索
    const newCards = document.querySelectorAll('.bookshelf-grid .book-card');
    newCards[0].click();
    await waitFor(() => document.getElementById('searchInput'), 1000);

    const searchInput = document.getElementById('searchInput');
    searchInput.value = '曹操';
    searchInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));

    await waitFor(() => {
        return document.querySelector('.search-results');
    }, 2000);

    const results = document.querySelectorAll('.search-result-item');
    console.log('搜索结果数量:', results.length);
    if (results.length === 0) throw new Error('搜索没有返回结果');

    // 验证缓存写入
    const cachedIndex = window.localStorage.getItem('halo-index');
    if (!cachedIndex) throw new Error('index.json 没有缓存到 localStorage');
    console.log('index.json 已缓存到 localStorage');

    const cachedSearch = window.localStorage.getItem('halo-search-index');
    if (!cachedSearch) throw new Error('search-index.json 没有缓存到 localStorage');
    console.log('search-index.json 已缓存到 localStorage');

    console.log('\n✅ 所有端到端测试通过');
    dom.window.close();
}

function waitFor(fn, timeout) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const timer = setInterval(() => {
            try {
                if (fn()) {
                    clearInterval(timer);
                    resolve();
                    return;
                }
            } catch (e) {
                clearInterval(timer);
                reject(e);
                return;
            }
            if (Date.now() - start > timeout) {
                clearInterval(timer);
                reject(new Error('等待超时'));
            }
        }, 50);
    });
}

runTest().catch((err) => {
    console.error('❌ 测试失败:', err);
    process.exit(1);
});
