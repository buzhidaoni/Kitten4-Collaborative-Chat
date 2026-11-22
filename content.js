









(function () {
    'use strict';
    if (window.__cmChatUI) return;

    
    var IS_EDITOR = (location.host === 'kitten4.codemao.cn' && location.pathname === '/');
    if (!IS_EDITOR && location.protocol !== 'file:') return;

    window.__cmChatUI = true;

    var myId = null;
    var myName = '';
    var myAvatar = '';
    var users = [];            

    var st = {
        connected: false, roomId: null, projectName: '', actorId: null,
        msgIn: 0, msgOut: 0, acks: 0, lastError: null, revision: 0
    };
    var msgs = [];
    var reqSeq = 0;
    var pendingSend = {};      
    var waitingAck = [];       
    var ackCredit = 0;         
    var unread = 0;
    var atPending = false;     
    var pageFocused = true;    
    var TITLE_BASE_DEFAULT = '全新源码编辑器 - 搭积木一样有趣的编程工具';
    var TITLE_RE = /^（你有\d+条消息未读）/;   
    var nodes = {};
    var open = false;
    var hideTimer = null;
    var pendingImgs = [];      
    var MAX_IMGS = 9;          
    var SEND_GAP = 600;        
    var mention = { open: false, items: [], index: 0 };

    
    var POS_KEY = 'cmc.pos.v1';
    var pos = null;            
    var dragStart = null;      
    var dragMoved = 0;
    var suppressClick = false; 
    var dragRaf = 0;

    
    var atSeen = {};           
    var jumpKey = '';          
    var jumpFallbackT = 0;     
    var scrollRaf = 0;
    var stickBottom = true;    

    window.__cmUiDebug = { clicks: 0, opens: 0, closes: 0 };

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    
    function hhmmss(ts) {
        var d = new Date(ts || Date.now());
        return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
    function label(name, id) {
        var n = name || '协作成员';
        return id ? n + ' #' + id : n;
    }
    function nameWithId(name, id) {
        var frag = document.createDocumentFragment();
        frag.appendChild(el('span', 'cmc-name', name || '协作成员'));
        if (id) frag.appendChild(el('span', 'cmc-uid', '#' + id));
        return frag;
    }
    function findUser(id) {
        if (!id) return null;
        for (var i = 0; i < users.length; i++) if (Number(users[i].id) === Number(id)) return users[i];
        return null;
    }
    function initial(name) {
        var s = String(name || '?').trim();
        return s ? s.slice(0, 1).toUpperCase() : '?';
    }
    function avatarNode(name, id, url, small) {
        var box = el('div', 'cmc-ava' + (small ? ' cmc-ava-sm' : ''));
        if (url) {
            var img = document.createElement('img');
            img.src = url;
            img.alt = '';
            img.referrerPolicy = 'no-referrer';
            box.appendChild(img);
        } else {
            
            box.appendChild(el('span', 'cmc-ava-txt', initial(name)));
        }
        return box;
    }

    

    var ICON_AT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">' +
        '<circle cx="12" cy="12" r="4.1"/><path d="M16.1 12v1.4a2.5 2.5 0 0 0 5 0V12a9.1 9.1 0 1 0-3.4 7.1"/></svg>';
    var ICON_IMG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="3.4"/><circle cx="9" cy="10" r="1.6" fill="currentColor" stroke="none"/>' +
        '<path d="M4.6 17.4 9.8 13l3.3 3 2.5-2.2 3.8 3.6"/></svg>';

    function build() {
        if (document.getElementById('cmc-root')) return;
        if (!document.documentElement) return;

        var root = el('div', 'cmc-root cmc-off');
        root.id = 'cmc-root';

        var panel = el('div', 'cmc-panel cmc-hidden');
        panel.id = 'cmc-panel';

        var head = el('div', 'cmc-head');
        var title = el('div', 'cmc-title');
        var dot = el('span', 'cmc-dot');
        dot.id = 'cmc-dot';
        title.appendChild(dot);
        title.appendChild(el('span', 'cmc-title-txt', 'Kitten4 协作聊天'));
        var me = el('span', 'cmc-me', '协作成员');
        me.id = 'cmc-me';
        me.title = '我的协作身份';
        title.appendChild(me);
        head.appendChild(title);
        panel.appendChild(head);

        var bar = el('div', 'cmc-bar', '等待协作连接…');
        bar.id = 'cmc-bar';
        panel.appendChild(bar);

        var list = el('div', 'cmc-list');
        list.id = 'cmc-list';
        
        var empty = el('div', 'cmc-empty');
        empty.id = 'cmc-empty';
        empty.appendChild(el('div', 'cmc-empty-t', '还没有消息'));
        list.appendChild(empty);
        panel.appendChild(list);

        
        var preview = el('div', 'cmc-preview cmc-hidden');
        preview.id = 'cmc-preview';
        var previewStrip = el('div', 'cmc-preview-strip');
        previewStrip.id = 'cmc-preview-strip';
        var previewMeta = el('div', 'cmc-preview-meta');
        previewMeta.id = 'cmc-preview-meta';
        var previewX = el('button', 'cmc-preview-x', '×');
        previewX.title = '全部取消';
        previewX.type = 'button';
        preview.appendChild(previewStrip);
        preview.appendChild(previewMeta);
        preview.appendChild(previewX);
        panel.appendChild(preview);

        
        var menu = el('div', 'cmc-mention cmc-hidden');
        menu.id = 'cmc-mention';
        panel.appendChild(menu);

        
        var jump = el('button', 'cmc-jump cmc-hidden');
        jump.id = 'cmc-jump';
        jump.type = 'button';
        jump.title = '跳到被 @ 的那条消息';
        jump.appendChild(el('span', 'cmc-jump-dot'));
        var jumpTxt = el('span', 'cmc-jump-txt', '');
        jumpTxt.id = 'cmc-jump-txt';
        jump.appendChild(jumpTxt);
        var jumpGo = el('span', 'cmc-jump-go');
        jumpGo.innerHTML =
            '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ' +
            'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M12 19.5V5M5.2 11.6 12 4.8l6.8 6.8"/></svg>';
        jump.appendChild(jumpGo);
        panel.appendChild(jump);

        var inputArea = el('div', 'cmc-input-area');

        var atBtn = el('button', 'cmc-icon-btn');
        atBtn.id = 'cmc-at';
        atBtn.type = 'button';
        atBtn.title = '提及成员';
        atBtn.innerHTML = ICON_AT;

        var imgBtn = el('button', 'cmc-icon-btn');
        imgBtn.id = 'cmc-img';
        imgBtn.type = 'button';
        imgBtn.title = '发送图片';
        imgBtn.innerHTML = ICON_IMG;

        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'cmc-input';
        input.maxLength = 300;
        input.placeholder = '说点什么…';

        var sendBtn = el('button', 'cmc-send', '发送');
        sendBtn.id = 'cmc-send';

        inputArea.appendChild(atBtn);
        inputArea.appendChild(imgBtn);
        inputArea.appendChild(input);
        inputArea.appendChild(sendBtn);
        panel.appendChild(inputArea);

        var file = document.createElement('input');
        file.type = 'file';
        file.accept = 'image/png,image/jpeg,image/webp,image/gif';
        file.multiple = true;
        file.id = 'cmc-file';
        file.className = 'cmc-file';
        panel.appendChild(file);

        var btn = el('div', 'cmc-btn');
        btn.id = 'cmc-btn';
        btn.title = 'Kitten4 协作聊天';
        btn.setAttribute('role', 'button');
        btn.setAttribute('aria-expanded', 'false');

        var icon = el('span', 'cmc-btn-icon');
        icon.innerHTML =
            '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
            '<path d="M12 4.2c-4.4 0-8 2.9-8 6.5 0 2 1.1 3.9 2.9 5.1l-.7 2.9c-.1.4.3.6.6.4l3-1.6c.7.2 1.4.3 2.2.3 4.4 0 8-2.9 8-6.5s-3.6-6.6-8-6.6z" ' +
            'fill="currentColor" opacity=".9"/>' +
            '<circle cx="8.9" cy="10.7" r="1" fill="#fff" opacity=".92"/>' +
            '<circle cx="12" cy="10.7" r="1" fill="#fff" opacity=".92"/>' +
            '<circle cx="15.1" cy="10.7" r="1" fill="#fff" opacity=".92"/></svg>';
        var chevron = el('span', 'cmc-btn-chevron');
        chevron.innerHTML =
            '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
            '<path d="M6.5 9.5 12 15l5.5-5.5" fill="none" stroke="currentColor" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round"/></svg>';
        btn.appendChild(icon);
        btn.appendChild(chevron);

        var badge = el('span', 'cmc-badge cmc-hidden');
        badge.id = 'cmc-badge';
        btn.appendChild(badge);

        var tip = el('div', 'cmc-refresh-tip cmc-hidden');
        tip.id = 'cmc-refresh-tip';
        var tipText = el('span', 'cmc-refresh-tip-text', '刷新页面后启用聊天');
        tipText.id = 'cmc-refresh-tip-text';
        var tipBtn = el('button', 'cmc-refresh-tip-btn', '刷新页面');
        tipBtn.id = 'cmc-refresh-tip-btn';
        tipBtn.type = 'button';
        var tipClose = el('button', 'cmc-refresh-tip-close', '×');
        tipClose.id = 'cmc-refresh-tip-close';
        tipClose.type = 'button';
        tipClose.title = '知道了';
        tip.appendChild(tipText);
        tip.appendChild(tipBtn);
        tip.appendChild(tipClose);

        var lightbox = el('div', 'cmc-lightbox cmc-hidden');
        lightbox.id = 'cmc-lightbox';
        var bigImg = document.createElement('img');
        bigImg.alt = '';
        lightbox.appendChild(bigImg);

        root.appendChild(panel);
        root.appendChild(btn);
        root.appendChild(tip);
        root.appendChild(lightbox);
        document.documentElement.appendChild(root);

        nodes = {
            root: root, panel: panel, list: list, input: input, sendBtn: sendBtn,
            bar: bar, dot: dot, me: me, btn: btn, badge: badge, icon: icon, chevron: chevron,
            preview: preview, previewStrip: previewStrip, previewMeta: previewMeta, previewX: previewX,
            menu: menu, atBtn: atBtn, imgBtn: imgBtn, file: file,
            empty: empty,
            jump: jump, jumpTxt: jumpTxt,
            tip: tip, tipText: tipText, tipBtn: tipBtn, tipClose: tipClose,
            lightbox: lightbox, bigImg: bigImg
        };
        bind();
        loadPos();
        maybeShowReloadTip();
        renderStatus();
        renderList();
        renderIdentity();
    }

    function bind() {
        nodes.btn.addEventListener('click', function () {
            if (suppressClick) { suppressClick = false; return; }   
            var dbg = window.__cmUiDebug;
            if (dbg) { dbg.clicks++; dbg.lastClickConnected = !!st.connected; dbg.lastClickOpen = open; }
            if (!st.connected) return;
            setOpen(!open);
        });
        nodes.btn.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            if (st.connected) setOpen(!open);
        });

        
        nodes.btn.addEventListener('pointerdown', onDragStart);
        nodes.btn.addEventListener('pointermove', onDragMove);
        nodes.btn.addEventListener('pointerup', onDragEnd);
        nodes.btn.addEventListener('pointercancel', onDragEnd);

        nodes.jump.addEventListener('click', jumpToAt);


        nodes.input.addEventListener('keydown', onInputKey);
        nodes.input.addEventListener('input', function () { refreshMention(); });
        nodes.sendBtn.addEventListener('click', doSend);

        nodes.atBtn.addEventListener('click', function (e) {
            e.preventDefault();
            insertAt();
        });
        nodes.imgBtn.addEventListener('click', function () { nodes.file.click(); });
        nodes.file.addEventListener('change', function () {
            var picked = nodes.file.files ? Array.prototype.slice.call(nodes.file.files) : [];
            nodes.file.value = '';          
            if (picked.length) addImages(picked);
        });
        nodes.previewX.addEventListener('click', clearImage);
        nodes.lightbox.addEventListener('click', function () { nodes.lightbox.classList.add('cmc-hidden'); });

        
        nodes.panel.addEventListener('mousedown', function (e) {
            if (!mention.open) return;
            if (nodes.menu.contains(e.target) || nodes.atBtn.contains(e.target)) return;
            closeMention();
        });

        nodes.list.addEventListener('scroll', function () {
            stickBottom = (nodes.list.scrollHeight - nodes.list.scrollTop - nodes.list.clientHeight) < 28;
            if (scrollRaf) return;
            scrollRaf = requestAnimationFrame(function () { scrollRaf = 0; updateAtJump(); });
        });

        window.addEventListener('resize', function () {
            if (pos) applyPos(pos.x, pos.y, false);
            placePanel();
            updateAtJump();
        });

        nodes.tipBtn.addEventListener('click', function () {
            try { if (chrome && chrome.storage && chrome.storage.local) chrome.storage.local.remove('cmcNeedReloadAt'); } catch (e) {}
            location.reload();
        });
        nodes.tipClose.addEventListener('click', function () {
            nodes.tip.classList.add('cmc-hidden');
            nodes.root.classList.remove('cmc-need-reload');
        });

        window.addEventListener('message', onMessage);
    }

    function maybeShowReloadTip() {
        if (!nodes.tip) return;
        try {
            if (!chrome || !chrome.storage || !chrome.storage.local) return;
        } catch (e) { return; }
        chrome.storage.local.get('cmcNeedReloadAt', function (data) {
            var t = data && data.cmcNeedReloadAt;
            if (typeof t !== 'number') return;
            var origin = (window.performance && performance.timeOrigin) ? performance.timeOrigin : Date.now();
            if (origin >= t) return;
            nodes.tip.classList.remove('cmc-hidden');
            nodes.root.classList.add('cmc-need-reload');
            placeTip();
        });
    }

    function placeTip() {
        if (!nodes.tip || nodes.tip.classList.contains('cmc-hidden')) return;
        var v = viewport(), s = ballSize();
        var x = pos ? pos.x : 0, y = pos ? pos.y : 0;
        var tw = nodes.tip.offsetWidth || 280;
        var th = nodes.tip.offsetHeight || 44;
        var toRight = (x + s / 2) > v.w / 2;
        var down = (y - th - 58) < 8;
        nodes.tip.classList.toggle('cmc-tip-right', toRight);
        nodes.tip.classList.toggle('cmc-tip-down', down);
        var room = toRight ? x + s - 8 : v.w - x - 8;
        nodes.tip.style.maxWidth = Math.max(180, Math.min(300, room)) + 'px';
    }

    function viewport() {
        return { w: window.innerWidth || document.documentElement.clientWidth || 360,
                 h: window.innerHeight || document.documentElement.clientHeight || 640 };
    }
    function ballSize() {
        return (nodes.btn && nodes.btn.offsetWidth) || 44;
    }
    function clampPos(x, y) {
        var v = viewport(), s = ballSize(), m = 10;
        return {
            x: Math.min(Math.max(m, x), Math.max(m, v.w - s - m)),
            y: Math.min(Math.max(m, y), Math.max(m, v.h - s - m))
        };
    }

    
    function applyPos(x, y, animate) {
        if (!nodes.root) return;
        pos = clampPos(x, y);
        if (animate) {
            nodes.root.classList.add('cmc-anim');
            clearTimeout(applyPos.t);
            applyPos.t = setTimeout(function () { nodes.root.classList.remove('cmc-anim'); }, 380);
        }
        nodes.root.style.left = Math.round(pos.x) + 'px';
        nodes.root.style.top = Math.round(pos.y) + 'px';
        nodes.root.style.bottom = 'auto';
        placePanel();
        placeTip();
    }

    
    function placePanel() {
        if (!nodes.panel) return;
        var v = viewport(), s = ballSize();
        var ph = (nodes.panel.offsetHeight || 412);
        var x = pos ? pos.x : 0, y = pos ? pos.y : 0;

        var toRight = (x + s / 2) > v.w / 2;
        nodes.panel.classList.toggle('cmc-panel-right', toRight);

        var down = (y - ph - 18) < 8;
        nodes.panel.classList.toggle('cmc-panel-down', down);

        var room = down ? (v.h - y - s - 18) : (y - 18);
        nodes.panel.style.maxHeight = Math.max(200, Math.min(412, room)) + 'px';
    }

    function loadPos() {
        var p = null;
        try { p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (e) { p = null; }
        var v = viewport(), s = ballSize();
        if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') {
            p = { x: 20, y: v.h - s - 20 };     
        }
        applyPos(p.x, p.y, false);
    }
    function savePos() {
        try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) {}
    }

    function onDragStart(e) {
        if (e.button !== undefined && e.button !== 0) return;
        var r = nodes.btn.getBoundingClientRect();
        dragStart = { px: e.clientX, py: e.clientY, x: r.left, y: r.top, id: e.pointerId };
        dragMoved = 0;
        nodes.root.classList.remove('cmc-anim');   
        nodes.root.classList.add('cmc-dragging');
        try { nodes.btn.setPointerCapture(e.pointerId); } catch (err) {}
    }

    function onDragMove(e) {
        if (!dragStart) return;
        var dx = e.clientX - dragStart.px;
        var dy = e.clientY - dragStart.py;
        dragMoved = Math.max(dragMoved, Math.abs(dx) + Math.abs(dy));
        if (dragMoved < 3) return;
        nodes.btn.classList.add('cmc-drag-on');
        applyPos(dragStart.x + dx, dragStart.y + dy, false);
        if (!dragRaf) dragRaf = requestAnimationFrame(function () { dragRaf = 0; placePanel(); });
    }

    function onDragEnd(e) {
        if (!dragStart) return;
        dragStart = null;
        nodes.root.classList.remove('cmc-dragging');
        nodes.btn.classList.remove('cmc-drag-on');
        try { nodes.btn.releasePointerCapture(e.pointerId); } catch (err) {}

        if (dragMoved > 6) {
            
            suppressClick = true;
            setTimeout(function () { suppressClick = false; }, 400);
            applyPos(pos.x, pos.y, false);
            savePos();
            updateAtJump();
        }
        dragMoved = 0;
    }

    function setOpen(next) {
        if (window.__cmUiDebug) { if (next) window.__cmUiDebug.opens++; else window.__cmUiDebug.closes++; }
        open = next;
        nodes.panel.classList.toggle('cmc-hidden', !open);
        nodes.root.classList.toggle('cmc-open', open);
        nodes.btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
            nodes.badge.classList.add('cmc-hidden');
            nodes.badge.classList.remove('cmc-badge-at');
            nodes.badge.textContent = '';
            unread = 0;
            atPending = false;
            placePanel();
            ping();
            applyTitle();   
            setTimeout(function () {
                if (!open) return;
                if (stickBottom) nodes.list.scrollTop = nodes.list.scrollHeight;
                try { nodes.input.focus(); } catch (e) {}
                updateAtJump();
            }, 180);
        } else {
            closeMention();
            hideJump();
            try { nodes.input.blur(); } catch (e) {}
            
            if (unread > 0) {
                nodes.badge.textContent = atPending ? '@' : String(unread);
                nodes.badge.classList.toggle('cmc-badge-at', atPending);
                nodes.badge.classList.remove('cmc-hidden');
            }
            applyTitle();
        }
    }

    

    function clearImage() {
        pendingImgs = [];
        renderPreview();
    }

    
    function readImage(file, cb) {
        var fr = new FileReader();
        fr.onerror = function () { cb(null, '这张图读不出来'); };
        fr.onload = function () {
            var img = new Image();
            img.onerror = function () { cb(null, '这张图读不出来'); };
            img.onload = function () {
                var out = encodeImage(img);
                if (!out) { cb(null, '这张图压不小，换一张试试'); return; }
                cb(out);
            };
            img.src = fr.result;
        };
        fr.readAsDataURL(file);
    }

    




    var IMG_MAX = 600;
    var IMG_BUDGET = 52000;    
    var IMG_HARD = 54000;      
    var IMG_MIN = 200;         

    function hasAlpha(cv) {
        try {
            var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
            for (var i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
            return false;
        } catch (e) { return false; }
    }

    function encodeImage(img) {
        var w = img.width, h = img.height;
        if (!w || !h) return null;

        var side = IMG_MAX, alpha = false, first = true;
        for (var round = 0; round < 10; round++) {
            var scale = Math.min(1, side / Math.max(w, h));
            var cw = Math.max(1, Math.round(w * scale));
            var ch = Math.max(1, Math.round(h * scale));
            var cv = document.createElement('canvas');
            cv.width = cw; cv.height = ch;
            cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
            if (first) { alpha = hasAlpha(cv); first = false; }

            var url = alpha ? encodeAlpha(cv) : encodeJpeg(cv);
            if (url && url.length <= IMG_HARD) {
                return { url: url, w: cw, h: ch, alpha: alpha,
                    kb: Math.max(1, Math.round(url.length / 1024)) };
            }
            if (side <= IMG_MIN) break;
            side = Math.max(IMG_MIN, Math.round(side * 0.84));
        }
        return null;
    }

    
    function encodeJpeg(cv) {
        var q = 0.82, url = cv.toDataURL('image/jpeg', q);
        while (url.length > IMG_BUDGET && q > 0.34) {
            q -= 0.06;
            url = cv.toDataURL('image/jpeg', q);
        }
        return url;
    }

    
    function encodeAlpha(cv) {
        var best = cv.toDataURL('image/png');
        if (best.length <= IMG_BUDGET) return best;

        for (var q = 0.94; q >= 0.5; q -= 0.06) {
            var webp;
            try { webp = cv.toDataURL('image/webp', q); } catch (e) { break; }
            
            if (!webp || webp.indexOf('data:image/webp') !== 0) break;
            if (webp.length < best.length) best = webp;
            if (best.length <= IMG_BUDGET) break;
        }
        return best;
    }

    function renderPreview(stickEnd) {
        if (!nodes.previewStrip) return;
        var keepLeft = nodes.previewStrip.scrollLeft;
        while (nodes.previewStrip.firstChild) nodes.previewStrip.removeChild(nodes.previewStrip.firstChild);

        if (!pendingImgs.length) {
            nodes.preview.classList.add('cmc-hidden');
            nodes.previewMeta.textContent = '';
            updateAtJump();
            return;
        }
        hideJump();   

        pendingImgs.forEach(function (it, idx) {
            var box = el('div', 'cmc-thumb');
            var im = document.createElement('img');
            im.src = it.url;
            im.alt = '';
            box.appendChild(im);
            var del = el('button', 'cmc-thumb-x', '×');
            del.type = 'button';
            del.title = '移掉这张';
            del.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                pendingImgs.splice(idx, 1);
                renderPreview();
            });
            box.appendChild(del);
            nodes.previewStrip.appendChild(box);
        });

        var kb = pendingImgs.reduce(function (a, b) { return a + b.kb; }, 0);
        var tr = pendingImgs.filter(function (x) { return x.alpha; }).length;
        nodes.previewMeta.textContent = pendingImgs.length + ' 张 · ' + kb + 'KB' + (tr ? ' · 透明 ' + tr : '');
        nodes.preview.classList.remove('cmc-hidden');
        
        nodes.previewStrip.scrollLeft = stickEnd ? nodes.previewStrip.scrollWidth : keepLeft;
    }

    
    function addImages(files) {
        var list = Array.prototype.slice.call(files || []).filter(function (f) {
            return /^image\//.test(f.type || '');
        });
        if (!list.length) { sys('只能发图片', 'bad'); return; }

        var room = MAX_IMGS - pendingImgs.length;
        if (room <= 0) { sys('一次最多 ' + MAX_IMGS + ' 张，先发掉一些吧', 'bad'); return; }
        if (list.length > room) {
            sys('一次最多 ' + MAX_IMGS + ' 张，多出的 ' + (list.length - room) + ' 张没有加进来');
            list = list.slice(0, room);
        }

        var slots = new Array(list.length);
        var done = 0, failed = 0;
        list.forEach(function (f, i) {
            readImage(f, function (item, why) {
                if (item) slots[i] = item; else { failed++; if (why) sys(why, 'bad'); }
                if (++done < list.length) return;
                slots.forEach(function (it) { if (it) pendingImgs.push(it); });
                renderPreview(list.length === 1);
                if (pendingImgs.length) nodes.list.scrollTop = nodes.list.scrollHeight;
                if (failed && !pendingImgs.length) sys('图片没能加进来', 'bad');
            });
        });
    }

    

    function insertAt() {
        var input = nodes.input;
        var v = input.value;
        var pos = input.selectionStart === null ? v.length : input.selectionStart;
        var needSpace = pos > 0 && !/\s$/.test(v.slice(0, pos));
        var text = (needSpace ? ' ' : '') + '@';
        input.value = v.slice(0, pos) + text + v.slice(pos);
        var caret = pos + text.length;
        input.setSelectionRange(caret, caret);
        input.focus();
        refreshMention();
    }

    
    function currentMentionQuery() {
        var input = nodes.input;
        var pos = input.selectionStart === null ? input.value.length : input.selectionStart;
        var before = input.value.slice(0, pos);
        var m = /(^|\s)@([^\s@]{0,12})$/.exec(before);
        if (!m) return null;
        return { q: m[2] || '', start: m.index + m[1].length, end: pos };
    }

    function refreshMention() {
        var ctx = currentMentionQuery();
        if (!ctx) { closeMention(); return; }
        var q = ctx.q.toLowerCase();
        mention.items = users.filter(function (u) {
            if (myId && Number(u.id) === Number(myId)) return false;
            if (!q) return true;
            return String(u.n || '').toLowerCase().indexOf(q) >= 0 || String(u.id).indexOf(q) >= 0;
        }).slice(0, 6);
        mention.index = 0;
        mention.open = true;
        renderMention();
    }

    function renderMention() {
        if (!mention.open) { nodes.menu.classList.add('cmc-hidden'); return; }
        nodes.menu.classList.remove('cmc-hidden');
        nodes.menu.textContent = '';
        if (!mention.items.length) {
            nodes.menu.appendChild(el('div', 'cmc-mention-empty',
                users.length > 1 ? '没有匹配的成员' : '还没有其他成员在线'));
            return;
        }
        mention.items.forEach(function (u, i) {
            var row = el('div', 'cmc-mention-item' + (i === mention.index ? ' cmc-mention-on' : ''));
            row.appendChild(avatarNode(u.n, u.id, u.a, true));
            var box = el('div', 'cmc-mention-txt');
            box.appendChild(el('span', 'cmc-mention-name', u.n));
            box.appendChild(el('span', 'cmc-mention-id', '#' + u.id));
            row.appendChild(box);
            row.addEventListener('mousedown', function (e) {
                e.preventDefault();
                pickMention(u);
            });
            nodes.menu.appendChild(row);
        });
    }

    function closeMention() {
        mention.open = false;
        mention.items = [];
        if (nodes.menu) nodes.menu.classList.add('cmc-hidden');
    }

    function pickMention(u) {
        var input = nodes.input;
        var ctx = currentMentionQuery();
        if (!ctx) { closeMention(); return; }
        var v = input.value;
        var insert = '@' + (u.n || String(u.id)) + ' ';
        input.value = v.slice(0, ctx.start) + insert + v.slice(ctx.end);
        var caret = ctx.start + insert.length;
        input.setSelectionRange(caret, caret);
        input.focus();
        closeMention();
    }

    function onInputKey(e) {
        if (mention.open) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                mention.index = (mention.index + 1) % Math.max(1, mention.items.length);
                renderMention();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                mention.index = (mention.index - 1 + mention.items.length) % Math.max(1, mention.items.length);
                renderMention();
                return;
            }
            if (e.key === 'Enter' && mention.items[mention.index]) {
                e.preventDefault();
                pickMention(mention.items[mention.index]);
                return;
            }
            if (e.key === 'Escape') { e.preventDefault(); closeMention(); return; }
        }
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); doSend(); }
    }

    function collectMentions(text) {
        var ids = [];
        users.forEach(function (u) {
            if (!u.n || !u.id) return;
            if (text.indexOf('@' + u.n) >= 0) ids.push(Number(u.id));
        });
        return ids;
    }

    

    function sys(text, level) {
        msgs.push({ sys: true, text: text, level: level || 'info', ts: Date.now() });
        renderList();
    }

    


    function newMsg(text, imgs, mentions, group) {
        var reqId = 'r' + (++reqSeq);
        var m = {
            id: 'me_' + reqId, text: text, nickname: myName, uid: myId, avatar: myAvatar,
            img: imgs && imgs.length ? imgs[0] : '',
            imgs: imgs ? imgs.slice() : [],
            mentions: mentions || [], ts: Date.now(), self: true, state: 'sending',
            group: group || '', frames: 1, sentN: 0, ackN: 0, failN: 0
        };
        msgs.push(m);
        renderList();
        return m;
    }

    function sendFrame(m, text, img, mentions, group, gi, gt) {
        var reqId = 'r' + (++reqSeq);
        m.frames = Math.max(1, gt || 1);
        pendingSend[reqId] = m;
        window.postMessage({
            type: 'CM_SEND', text: text, nickname: myName, reqId: reqId,
            img: img, mentions: mentions || [],
            gid: group || '', gi: gi || 0, gt: gt || 1
        }, '*');
    }

    
    function syncMsgState(m) {
        var f = m.frames || 1;
        if ((m.failN || 0) > 0) { m.state = 'failed'; return; }
        if ((m.ackN || 0) >= f) { m.state = 'ack'; return; }
        if ((m.sentN || 0) >= f) { m.state = 'sent'; return; }
        m.state = 'sending';
    }

    function doSend() {
        var text = nodes.input.value.trim();
        if (!text && !pendingImgs.length) return;
        if (!st.connected) { sys('还没连上协作频道，进入多人编辑后会自动连上'); return; }

        var imgs = pendingImgs.slice();
        var mentions = text ? collectMentions(text) : [];

        nodes.input.value = '';
        clearImage();
        closeMention();

        if (!imgs.length) {
            var one = newMsg(text, [], mentions);
            sendFrame(one, text, '', mentions, '', 0, 1);
            return;
        }

        if (imgs.length === 1) {
            var single = newMsg(text, [imgs[0].url], mentions);
            sendFrame(single, text, imgs[0].url, mentions, '', 0, 1);
            return;
        }

        
        var gid = 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
        var group = newMsg(text, imgs.map(function (x) { return x.url; }), mentions, gid);
        var i = 0;
        (function step() {
            if (i >= imgs.length) return;
            var first = i === 0;
            
            sendFrame(group, first ? text : '', imgs[i].url, first ? mentions : [], gid, i, imgs.length);
            i++;
            if (i < imgs.length) setTimeout(step, SEND_GAP);
        })();
    }

    

    function onMessage(ev) {
        if (ev.source && ev.source !== window) return;
        var d = ev.data;
        if (!d || typeof d !== 'object') return;

        if (d.type === 'CM_STATUS') {
            st = d.s || st;
            renderStatus();
            return;
        }
        if (d.type === 'CM_IDENTITY') {
            
            var idSig = [d.userId || 0, d.name || '',
                (d.users || []).map(function (u) { return (u.id || 0) + ':' + (u.n || '') + ':' + (u.a || ''); }).join(',')
            ].join('|');
            if (idSig === lastIdSig) return;
            lastIdSig = idSig;

            if (d.userId) myId = d.userId;
            if (d.name) myName = d.name;
            if (Array.isArray(d.users)) users = d.users;
            var selfUser = findUser(myId);
            myAvatar = (selfUser && selfUser.a) || '';
            renderIdentity();
            renderList();
            if (mention.open) refreshMention();
            return;
        }
        if (d.type === 'CM_SENT') {
            var m = pendingSend[d.reqId];
            if (!m) return;
            delete pendingSend[d.reqId];
            if (d.ok) {
                m.sentN = (m.sentN || 0) + 1;
                if (ackCredit > 0) {
                    
                    ackCredit--;
                    m.ackN = (m.ackN || 0) + 1;
                } else {
                    waitingAck.push(m);
                    if (waitingAck.length > 60) waitingAck.shift();
                }
                syncMsgState(m);
                if ((m.sentN || 0) >= (m.frames || 1) && !m.lateTimer) {
                    m.lateTimer = setTimeout(function () {
                        if (m.state === 'sent') { m.state = 'sent-nolog'; renderList(); }
                    }, 3000);
                }
                renderList();
            } else {
                m.failN = (m.failN || 0) + 1;
                m.state = 'failed';
                m.error = d.error;
                renderList();
                sys(d.error || '发送失败', 'bad');
            }
            return;
        }
        if (d.type === 'CM_ACK') {
            if (d.code === 1) {
                if (waitingAck.length) {
                    var t = waitingAck.shift();
                    t.ackN = (t.ackN || 0) + 1;
                    syncMsgState(t);
                } else {
                    if (ackCredit < 12) ackCredit++;
                }
                renderList();
            } else if (d.code !== 1) {
                sys('服务器拒绝了这条消息（code=' + d.code + '）', 'bad');
            }
            return;
        }
        if (d.type === 'CM_RECEIVE') {
            var mm = d.m || {};
            if (mm.id && msgs.some(function (x) { return x.id === mm.id; })) return;

            
            var gid = (typeof mm.gid === 'string' && mm.gid) ? mm.gid : '';
            if (gid) {
                var host = null;
                for (var gi2 = msgs.length - 1; gi2 >= 0; gi2--) {
                    if (msgs[gi2].group === gid) { host = msgs[gi2]; break; }
                }
                if (host) {
                    var parts = host._parts || (host.img ? [{ i: 0, u: host.img }] : []);
                    if (mm.img) parts.push({ i: mm.gi || 0, u: mm.img });
                    parts.sort(function (a, b) { return a.i - b.i; });
                    host._parts = parts;
                    host.imgs = parts.map(function (x) { return x.u; }).filter(Boolean);
                    if (!host.img) host.img = mm.img || '';
                    if (!host.text && mm.text) host.text = mm.text;
                    if (!(host.mentions || []).length && mm.mentions && mm.mentions.length) {
                        host.mentions = mm.mentions;
                    }
                    renderList();
                    if (!open && isMentionMe(host)) notifyAt();
                    return;
                }
            }

            var rec = {
                id: mm.id, text: mm.text, nickname: mm.nickname, uid: mm.uid || 0,
                avatar: mm.avatar || '', img: mm.img || '',
                imgs: mm.img ? [mm.img] : [], group: gid,
                _parts: mm.img ? [{ i: mm.gi || 0, u: mm.img }] : [],
                mentions: Array.isArray(mm.mentions) ? mm.mentions : [],
                ts: mm.ts, self: false, state: 'ack'
            };
            msgs.push(rec);
            renderList();
            
            if (shouldCountUnread()) {
                if (isMentionMe(rec)) notifyAt();
                else {
                    unread++;
                    if (!atPending && !open) {
                        nodes.badge.classList.remove('cmc-badge-at');
                        nodes.badge.textContent = String(unread);
                        nodes.badge.classList.remove('cmc-hidden');
                    }
                }
                if (!open) {
                    nodes.btn.classList.add('cmc-flash');
                    setTimeout(function () { nodes.btn.classList.remove('cmc-flash'); }, 1600);
                }
                applyTitle();
            }
        }
    }

    
    function isMentionMe(m) {
        if (!m || m.self || m.sys || !myId) return false;
        if (!Array.isArray(m.mentions) || !m.mentions.length) return false;
        return m.mentions.some(function (id) { return Number(id) === Number(myId); });
    }

    
    function notifyAt() {
        unread++;
        atPending = true;
        if (!open) {
            nodes.badge.textContent = '@';
            nodes.badge.classList.add('cmc-badge-at');
            nodes.badge.classList.remove('cmc-hidden');
        }
        applyTitle();
    }

    
    
    function attended() {
        if (document.hidden || document.visibilityState === 'hidden') return false;
        return pageFocused;
    }

    
    function shouldCountUnread() {
        return !open || !attended();
    }

    
    function onBackToPage() {
        if (!attended()) return;
        if (open && unread > 0) {
            unread = 0;
            atPending = false;
            applyTitle();
        }
    }

    function watchPage() {
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) onBackToPage();
        });
        window.addEventListener('focus', function () { pageFocused = true; onBackToPage(); });
        window.addEventListener('blur', function () { pageFocused = false; });
    }

    
    


    function siteTitle() {
        var t = String(document.title || '');
        return t.replace(TITLE_RE, '') || TITLE_BASE_DEFAULT;
    }

    function applyTitle() {
        var base = siteTitle();
        var want = (unread > 0)
            ? ('（你有' + unread + '条消息未读）' + base)
            : base;
        if (document.title !== want) document.title = want;
    }

    function watchTitle() {
        try {
            var t = document.querySelector('title');
            if (!t || !window.MutationObserver) return;
            new MutationObserver(function () { applyTitle(); }).observe(t, {
                childList: true, characterData: true, subtree: true
            });
        } catch (e) {}
    }

    

    
    
    var themeKey = '';

    function readTint() {
        var probe = [document.documentElement, document.body];
        for (var i = 0; i < probe.length; i++) {
            if (!probe[i]) continue;
            try {
                var v = getComputedStyle(probe[i]).getPropertyValue('--theme-color-0').trim();
                var m = /(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
                if (m) return [+m[1], +m[2], +m[3]];
            } catch (e) {}
        }
        
        try {
            var h = document.querySelector('header[class*=header], div[class*=header--], div[class*=header]');
            if (h) {
                var m2 = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(h).backgroundColor);
                if (m2 && !(+m2[1] === 255 && +m2[2] === 255 && +m2[3] === 255)) return [+m2[1], +m2[2], +m2[3]];
            }
        } catch (e) {}
        return null;
    }

    function mix(c, to, k) { return Math.round(c + (to - c) * k); }

    function applyTheme() {
        if (!nodes.root) return;
        var rgb = readTint();
        if (!rgb) return;
        var key = rgb.join(',');
        if (key === themeKey) return;
        themeKey = key;
        var soft = rgb.map(function (c) { return mix(c, 255, .62); });   
        var deep = rgb.map(function (c) { return mix(c, 0, .34); });     
        nodes.root.style.setProperty('--cmc-tint', key);
        nodes.root.style.setProperty('--cmc-tint-soft', soft.join(','));
        nodes.root.style.setProperty('--cmc-tint-deep', deep.join(','));
    }

    var themeTimer = 0;
    function scheduleTheme() {
        if (themeTimer) return;
        themeTimer = setTimeout(function () { themeTimer = 0; applyTheme(); }, 40);
    }

    function watchTheme() {
        if (!window.MutationObserver) return;
        var mo = new MutationObserver(scheduleTheme);
        try {
            mo.observe(document.documentElement, {
                subtree: true, attributes: true, attributeFilter: ['style', 'class']
            });
            mo.observe(document.head, {
                subtree: true, childList: true, characterData: true,
                attributes: true, attributeFilter: ['href', 'rel', 'media']
            });
        } catch (e) {}
        document.addEventListener('click', scheduleTheme, true);
        document.addEventListener('visibilitychange', scheduleTheme, true);
        [0, 120, 400, 1000].forEach(function (t) { setTimeout(applyTheme, t); });
    }

    
    function readWorkName() {
        try {
            var inp = document.querySelector('input[placeholder="作品名称不能为空"]');
            if (inp && typeof inp.value === 'string') {
                var v = inp.value.trim();
                if (v) return v;
            }
            
            var top = document.querySelectorAll('input.CUI-input-common-input');
            for (var i = 0; i < top.length; i++) {
                var r = top[i].getBoundingClientRect();
                if (r.top > 60 || r.width < 60) continue;
                if (/作品名称|名称/.test(top[i].placeholder || '') && top[i].value.trim()) return top[i].value.trim();
            }
        } catch (e) {}
        return '';
    }

    function renderStatus() {
        if (!nodes.root) return;
        var s, cls;
        var workName = readWorkName() || st.projectName || '';
        if (st.connected && st.actorId) {
            
            var rid = st.roomId ? String(st.roomId) : '';
            var rname = workName || '房间';
            s = '已连接 · ' + rname + (rid ? '（' + rid + '）' : '');
            cls = 'cmc-dot cmc-dot-on';
        } else if (st.connected) {
            s = '正在同步房间信息…';
            cls = 'cmc-dot cmc-dot-wait';
        } else {
            s = '等待协作连接…';
            cls = 'cmc-dot';
        }
        nodes.bar.textContent = s;
        nodes.dot.className = cls;
        nodes.bar.title =
            (st.roomId ? '房间号 ' + st.roomId : '') +
            (workName ? ' · 作品：' + workName : '') +
            '\n收发 ' + st.msgOut + '/' + st.msgIn + ' · 回执 ' + st.acks +
            ' · rev ' + st.revision + (st.lastError ? ' · 错误 ' + st.lastError : '');

        if (st.connected) {
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
            nodes.root.classList.remove('cmc-off');
        } else if (!hideTimer && !nodes.root.classList.contains('cmc-off')) {
            hideTimer = setTimeout(function () {
                hideTimer = null;
                if (!st.connected) nodes.root.classList.add('cmc-off');
            }, 1200);
        }
    }

    function renderIdentity() {
        if (!nodes.me) return;
        nodes.me.textContent = label(myName, myId);
        nodes.me.title = myId ? ('协作 id：' + myId + (myName ? ' · ' + myName : '')) : '正在获取协作身份…';
    }

    






    var lastIdSig = '';
    var rowMap = {};           
    var rowSig = {};           

    function keyOf(m, i) {
        if (m.sys) return 'sys#' + i;
        return 'm#' + (m.id || ('i' + i + '_' + m.ts));
    }

    function sigOf(m) {
        var urls = m.imgs && m.imgs.length ? m.imgs : (m.img ? [m.img] : []);
        return [
            m.self ? 1 : 0, m.state || '', m.text || '', urls.length,
            urls.length ? urls[0].length + ':' + (urls[urls.length - 1] || '').slice(-24) : '',
            (m.mentions || []).join(','), m.nickname || '', m.uid || 0, m.ts || 0,
            m.self ? (myAvatar || '') : (m.avatar || ''), myId || 0
        ].join('|');
    }

    function buildRow(m, atMe) {
        if (m.sys) return el('div', 'cmc-sys' + (m.level === 'bad' ? ' cmc-sys-bad' : ''), m.text);

        var row = el('div', 'cmc-row ' + (m.self ? 'cmc-row-self' : 'cmc-row-other'));
        var avaUrl = m.self ? myAvatar : (m.avatar || '');
        row.appendChild(avatarNode(m.self ? myName : m.nickname, m.self ? myId : m.uid, avaUrl));

        var wrap = el('div', 'cmc-msg ' + (m.self ? 'cmc-self' : 'cmc-other') + (atMe ? ' cmc-at' : ''));

        var meta = el('div', 'cmc-meta');
        meta.appendChild(m.self ? nameWithId('我', myId) : nameWithId(m.nickname, m.uid));
        meta.appendChild(el('span', 'cmc-time', hhmmss(m.ts)));
        if (atMe) meta.appendChild(el('span', 'cmc-atme', '@我'));
        if (m.self && m.state === 'ack') {
            var tick = el('span', 'cmc-tick', '✓');
            tick.title = '服务器已接收（operation_ack code=1）';
            meta.appendChild(tick);
        }
        wrap.appendChild(meta);

        
        var urls = m.imgs && m.imgs.length ? m.imgs : (m.img ? [m.img] : []);
        if (urls.length) {
            var n = urls.length;
            var box = el('div', 'cmc-imgs' + (n >= 5 ? ' cmc-imgs-3' : '') + (n === 1 ? ' cmc-imgs-1' : ''));
            urls.forEach(function (u) {
                if (!u) return;
                var im = document.createElement('img');
                im.className = 'cmc-img';
                im.alt = '图片';
                im.src = u;
                im.addEventListener('click', function () {
                    nodes.bigImg.src = u;
                    nodes.lightbox.classList.remove('cmc-hidden');
                });
                
                im.addEventListener('load', function () {
                    if (stickBottom && nodes.list) nodes.list.scrollTop = nodes.list.scrollHeight;
                });
                box.appendChild(im);
            });
            wrap.appendChild(box);
        }
        if (m.text) wrap.appendChild(el('div', 'cmc-text', m.text));

        if (m.state === 'sending') wrap.appendChild(el('div', 'cmc-flag', '发送中…'));
        if (m.state === 'sent-nolog') wrap.appendChild(el('div', 'cmc-flag', '已发出（未收到回执）'));
        if (m.state === 'failed') wrap.appendChild(el('div', 'cmc-flag cmc-flag-bad', '发送失败'));

        row.appendChild(wrap);
        return row;
    }

    function renderList() {
        if (!nodes.list) return;

        var slice = msgs.slice(-200);
        var base = msgs.length - slice.length;
        var list = nodes.list;
        var h0 = list.scrollHeight;

        
        var wanted = {};
        var i, m, key;
        for (i = 0; i < slice.length; i++) wanted[keyOf(slice[i], base + i)] = 1;
        Object.keys(rowMap).forEach(function (k) {
            if (!wanted[k]) {
                if (rowMap[k].parentNode === nodes.list) nodes.list.removeChild(rowMap[k]);
                delete rowMap[k];
                delete rowSig[k];
            }
        });

        
        var appended = false, mineAppended = false;
        for (i = 0; i < slice.length; i++) {
            m = slice[i];
            key = keyOf(m, base + i);
            var atMe = !m.sys && !m.self && Array.isArray(m.mentions) && myId &&
                m.mentions.some(function (id) { return Number(id) === Number(myId); });
            var sig = sigOf(m);

            if (!rowMap[key]) {
                var node = buildRow(m, atMe);
                node.setAttribute('data-key', key);
                if (!m.sys) node.classList.add('cmc-row-in');    
                nodes.list.appendChild(node);
                rowMap[key] = node;
                rowSig[key] = sig;
                appended = true;
                if (!m.sys && m.self) mineAppended = true;
            } else if (rowSig[key] !== sig) {
                var fresh = buildRow(m, atMe);                  
                fresh.setAttribute('data-key', key);
                nodes.list.replaceChild(fresh, rowMap[key]);
                rowMap[key] = fresh;
                rowSig[key] = sig;
            }
        }

        
        var grew = list.scrollHeight !== h0;
        if ((stickBottom && (appended || grew)) || mineAppended) {
            nodes.list.scrollTop = nodes.list.scrollHeight;
            stickBottom = true;
        }
        if (appended || grew) updateAtJump();

        if (nodes.empty) {
            var real = 0;
            for (i = 0; i < msgs.length; i++) if (!msgs[i].sys) { real++; break; }
            nodes.empty.classList.toggle('cmc-hidden', real > 0);
        }
    }

    

    function atList() {
        var out = [];
        for (var i = 0; i < msgs.length; i++) {
            var m = msgs[i];
            if (!isMentionMe(m)) continue;
            out.push({ key: keyOf(m, i), name: m.nickname || '有人' });
        }
        return out;
    }

    function hideJump() {
        jumpKey = '';
        if (nodes.jump) nodes.jump.classList.add('cmc-hidden');
        if (nodes.panel) nodes.panel.classList.remove('cmc-jump-on');
    }

    
    function updateAtJump() {
        if (!nodes.jump) return;
        if (!open || !nodes.list || !myId || pendingImgs.length) { hideJump(); return; }

        var target = null;
        var items = atList();
        for (var i = items.length - 1; i >= 0; i--) {
            if (!rowMap[items[i].key]) continue;
            target = items[i];
            break;
        }
        if (!target) { hideJump(); return; }

        var node = rowMap[target.key];
        var lr = nodes.list.getBoundingClientRect();
        var nr = node.getBoundingClientRect();
        var hidden = nr.bottom < lr.top + 4 || nr.top > lr.bottom - 4;

        if (!hidden || atSeen[target.key]) { hideJump(); return; }

        jumpKey = target.key;
        nodes.jump.setAttribute('data-key', target.key);
        nodes.jumpTxt.textContent = target.name + ' @ 了你';
        nodes.jump.classList.toggle('cmc-jump-down', nr.top > lr.bottom - 4);
        nodes.jump.classList.remove('cmc-hidden');
        
        nodes.panel.classList.add('cmc-jump-on');
        if (stickBottom) nodes.list.scrollTop = nodes.list.scrollHeight;
    }

    function jumpToAt() {
        if (window.__cmUiDebug) window.__cmUiDebug.jumpClicks = (window.__cmUiDebug.jumpClicks || 0) + 1;
        var key = nodes.jump.getAttribute('data-key') || jumpKey;
        var node = key && rowMap[key];
        if (!node) { updateAtJump(); return; }
        atSeen[key] = 1;

        var lr = nodes.list.getBoundingClientRect();
        var nr = node.getBoundingClientRect();
        var top = nodes.list.scrollTop + (nr.top - lr.top) - Math.max(0, (lr.height - nr.height) / 2);
        
        stickBottom = false;
        if (window.__cmUiDebug) window.__cmUiDebug.lastJump = { key: key, from: nodes.list.scrollTop, to: top, h: nr.height };
        try { nodes.list.scrollTo({ top: top, behavior: 'smooth' }); }
        catch (e) { nodes.list.scrollTop = top; }
        
        clearTimeout(jumpFallbackT);
        jumpFallbackT = setTimeout(function () {
            if (Math.abs(nodes.list.scrollTop - top) > 4) nodes.list.scrollTop = top;
        }, 420);

        node.classList.remove('cmc-hit');
        void node.offsetWidth;
        node.classList.add('cmc-hit');
        setTimeout(function () { node.classList.remove('cmc-hit'); }, 1700);

        hideJump();
    }

    function ping() { window.postMessage({ type: 'CM_PING' }, '*'); }

    function start() {
        build();
        applyTheme();
        watchTheme();
        watchTitle();
        watchPage();
        setTimeout(ping, 300);
        setTimeout(ping, 1200);
        setInterval(ping, 5000);

        
        var lastWork = readWorkName();
        setInterval(function () {
            var now = readWorkName();
            if (now && now !== lastWork) { lastWork = now; renderStatus(); }
        }, 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 700); });
    } else {
        setTimeout(start, 700);
    }
    setTimeout(function () { if (!document.getElementById('cmc-root')) build(); }, 3000);
})();
