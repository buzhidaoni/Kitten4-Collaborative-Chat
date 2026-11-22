/* ============================================================================
 * 编程猫 Kitten4 协作 · 无痕聊天  Inject（MAIN world / document_start）
 * ----------------------------------------------------------------------------
 * 真实协议（2026-11 抓包实测，见 tools/logs）：
 *   连接   wss://socketcoll.codemao.cn:8098/collaborate/?work_id=<id>&EIO=3&transport=websocket
 *   入房   42["join",<workId>]  ←  42["join_ack",{code:1,data:{doc,revision}}]
 *   发送   42["operation",{revision,op:[[cmd]],lock:[]}]
 *   回执   42["operation_ack",{code:1,...}]
 *   收到   42["operation_relay",{code:1,op:[[cmd]],...}]   ← 别人的操作都从这里来
 *   注释   ["theatre","actors",<actorId>,"block_data_json","comments",<cid>,
 *            {"i":{id,parent_id,text,pinned,size,location,auto_layout,color_theme}}]
 *   删除   ["theatre","actors",<actorId>,"block_data_json","comments",<cid>,{"r":true}]
 *
 * 聊天 = 一条「飞出工作区的原生注释」，正文带专属暗号；接收端在引擎消费之前拦下。
 * ==========================================================================*/
(function () {
    'use strict';
    if (window.__cmChatInstalled) return;
    window.__cmChatInstalled = true;

    var VERSION = '3.5';
    var PREFIX = '#%^&114514*/n';     // 暗号：只有带它的注释才会被当成聊天
    var COLLAB_HOST = 'socketcoll.codemao.cn';
    var COMMENT_LOCATION = [100, 100]; // 注释坐标（按需求固定在 100,100）
    var COMMENT_SIZE = [140, 48];
    var KEEP_MS = 1500;                // 发出后多久删掉（给对端留够接收时间）
    var NativeWebSocket = window.WebSocket;

    var state = {
        version: VERSION,
        clientId: 'c' + Math.random().toString(36).slice(2, 10),
        connected: false,
        roomId: null,
        actorId: null,
        sceneId: null,
        userId: null,       // 协作频道里的用户 id（从 operation_ack 学）
        selfName: null,     // 站内昵称（从在线状态帧学）
        revision: 1,
        framesIn: 0,
        msgIn: 0,
        msgOut: 0,
        acks: 0,
        lastAck: null,
        lastError: null
    };
    state.users = Object.create(null);   // id -> { n: 昵称, a: 头像 }
    window.__cmChatDebug = state;   // 控制台可查

    var seen = Object.create(null);
    var seenN = 0;
    var socket = null;

    /* ---------------- 与 UI 通信 ---------------- */

    function toUI(msg) {
        msg.__cmChat = 1;
        window.postMessage(msg, '*');
    }
    function status() {
        toUI({
            type: 'CM_STATUS',
            s: {
                connected: state.connected,
                roomId: state.roomId,
                projectName: state.projectName || '',
                actorId: state.actorId,
                revision: state.revision,
                msgIn: state.msgIn,
                msgOut: state.msgOut,
                acks: state.acks,
                lastAck: state.lastAck,
                lastError: state.lastError
            }
        });
    }

    /* 身份：id 来自协作频道的 operation_ack，昵称来自 svr_user_status_change
     * （都是协作通道里推下来的真实数据，不是本地随机生成的） */
    function identity() {
        var list = [];
        Object.keys(state.users).forEach(function (id) {
            var u = state.users[id];
            if (!u || !u.n) return;
            list.push({ id: Number(id) || id, n: u.n, a: u.a || '' });
        });
        toUI({
            type: 'CM_IDENTITY',
            userId: state.userId || null,
            name: state.selfName || '',
            users: list
        });
    }

    function resolveSelfName() {
        if (!state.userId) return;
        var u = state.users[state.userId];
        if (u && u.n && u.n !== state.selfName) {
            state.selfName = u.n;
            identity();
        }
    }

    function learnUser(u) {
        if (!u || u.id === undefined || u.id === null) return;
        var id = Number(u.id) || u.id;
        var name = typeof u.nickname === 'string' ? u.nickname : (typeof u.name === 'string' ? u.name : '');
        var prev = state.users[id];
        var next = { n: name || (prev ? prev.n : ''), a: u.avatar_url || (prev ? prev.a : '') };
        state.users[id] = next;
        var changed = !prev || prev.n !== next.n || prev.a !== next.a;
        if (state.userId !== null && Number(state.userId) === Number(id)) {
            if (next.n && next.n !== state.selfName) { state.selfName = next.n; changed = true; }
        }
        if (changed) identity();     // 成员表变了：@ 列表和头像要跟着更新
    }

    function learnSelfId(id) {
        var n = Number(id);
        if (!n) return;
        if (state.userId !== n) {
            state.userId = n;
            resolveSelfName();
            identity();
        }
    }
    function log() {
        try { console.log.apply(console, ['%c[无痕聊天]', 'color:#0a84ff;font-weight:bold'].concat([].slice.call(arguments))); } catch (e) {}
    }

    /* ---------------- Socket.IO v2 帧解析 ---------------- */

    function parseFrame(raw) {
        if (typeof raw !== 'string' || raw.charAt(0) !== '4' || raw.charAt(1) !== '2') return null;
        var s = raw.slice(2), nsp = '/';
        if (s.charAt(0) === '/') {
            var comma = s.indexOf(',');
            if (comma < 0) return null;
            nsp = s.slice(0, comma);
            s = s.slice(comma + 1);
        }
        var i = 0;
        while (i < s.length && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) i++;
        if (i) s = s.slice(i);
        if (s.charAt(0) !== '[') return null;
        var arr;
        try { arr = JSON.parse(s); } catch (e) { return null; }
        if (!Array.isArray(arr) || typeof arr[0] !== 'string') return null;
        return { name: arr[0], args: arr.slice(1), nsp: nsp };
    }

    // op 里可能是 [[cmd]] / [[cmd1, cmd2]]，把命令摊平
    function flattenOps(op) {
        var out = [];
        (function walk(node) {
            if (!Array.isArray(node)) return;
            if (typeof node[0] === 'string') { out.push(node); return; }
            node.forEach(walk);
        })(op);
        return out;
    }

    // 命令是不是「我们造的聊天注释」：返回 {kind:'create'|'delete', cid, text}
    function inspectComment(cmd) {
        var i = cmd.indexOf('comments');
        if (i < 0 || cmd[0] !== 'theatre') return null;
        var cid = cmd[i + 1];
        var action = cmd[i + 2];
        if (typeof cid !== 'string' || !action || typeof action !== 'object') return null;
        var isOurs = cid.indexOf('chat_') === 0;

        if (action.i && typeof action.i === 'object' && typeof action.i.text === 'string') {
            if (action.i.text.indexOf(PREFIX) !== 0) return null;   // 普通注释：不碰
            return { kind: 'create', cid: cid, text: action.i.text.slice(PREFIX.length) };
        }
        if (action.r === true && isOurs) return { kind: 'delete', cid: cid };
        return null;
    }

    /* ---------------- 学习房间 / 角色 / 版本号 ---------------- */

    /* 从 join_ack 的文档里直接挑一个可用的角色 ID。
     * 注释必须挂在「某个角色」的 block_data_json 上，所以只要文档到手，
     * 角色 ID 就是现成的——不需要用户去拖动任何积木。
     * 兼容三种写法：scene.actors 数组 / scene.actors 字典 / theatre.actors 字典。 */
    function pickActorId(doc) {
        try {
            var theatre = doc && doc.theatre;
            if (!theatre) return null;

            var list = [], seenIds = Object.create(null);
            function push(id, why) {
                if (typeof id !== 'string' || !id || seenIds[id]) return;
                seenIds[id] = 1;
                list.push({ id: id, why: why });
            }

            var sceneId = theatre.current_scene;
            var scene = theatre.scenes && theatre.scenes[sceneId];
            if (scene) {
                var sa = scene.actors;
                if (Array.isArray(sa)) sa.forEach(function (id) { push(id, 'scene'); });
                else if (sa && typeof sa === 'object') Object.keys(sa).forEach(function (id) { push(id, 'scene'); });
                if (typeof scene.current_actor === 'string') push(scene.current_actor, 'scene');
            }

            var ta = theatre.actors;
            if (Array.isArray(ta)) ta.forEach(function (id) { push(id, 'theatre'); });
            else if (ta && typeof ta === 'object') Object.keys(ta).forEach(function (id) { push(id, 'theatre'); });

            // 当前场景没登记角色时，翻一遍所有场景
            if (!list.length) {
                Object.keys(theatre.scenes || {}).forEach(function (k) {
                    var a = (theatre.scenes[k] || {}).actors;
                    if (Array.isArray(a)) a.forEach(function (id) { push(id, 'any-scene'); });
                    else if (a && typeof a === 'object') Object.keys(a).forEach(function (id) { push(id, 'any-scene'); });
                });
            }
            if (!list.length) return null;

            // 优先挑真的带 block_data_json 的角色（注释就挂在那上面）
            var actorsMap = (ta && !Array.isArray(ta) && typeof ta === 'object') ? ta : null;
            var best = null;
            list.forEach(function (c) {
                var rec = actorsMap ? actorsMap[c.id] : null;
                var score = 0;
                if (rec && rec.block_data_json) score += 4;
                if (c.why === 'scene') score += 2;
                if (!best || score > best.score) best = { id: c.id, score: score, why: c.why };
            });
            state.actorSource = best.why;
            return best.id;
        } catch (e) {
            state.lastError = 'pickActor: ' + e.message;
            return null;
        }
    }

    function learnFromJoinAck(payload) {
        try {
            var d = payload && payload.data;
            state.joinInfo = { code: payload && payload.code };
            if (!d || !d.doc) { state.lastError = 'join_ack 没有 doc'; return; }
            state.joinInfo.docKeys = Object.keys(d.doc).slice(0, 12);
            var theatre = d.doc.theatre;
            if (!theatre) { state.lastError = 'doc 里没有 theatre'; return; }
            state.joinInfo.theatreKeys = Object.keys(theatre).slice(0, 12);

            // 缓存整份文档：万一 join_ack 先于其它帧被解析异常，后续还能重试用
            state.doc = d.doc;

            // 作品名（房间显示用）
            var pn = d.doc.project_name || d.doc.work_name || '';
            if (typeof pn === 'string' && pn) state.projectName = pn;

            var sceneId = theatre.current_scene;
            if (sceneId) state.sceneId = sceneId;
            if (typeof d.revision === 'number') state.revision = Math.max(state.revision, d.revision);

            var id = pickActorId(d.doc);
            if (id) {
                state.actorId = id;
                state.joinInfo.actors = (theatre.actors && !Array.isArray(theatre.actors))
                    ? Object.keys(theatre.actors).length
                    : (Array.isArray(theatre.actors) ? theatre.actors.length : 0);
            }
            status();
            sweepLegacy(d.doc);
        } catch (e) { state.lastError = 'join_ack: ' + e.message; }
    }

    function learnFromOp(cmd) {
        if (cmd[0] === 'theatre' && cmd[1] === 'actors' && typeof cmd[2] === 'string') {
            if (state.actorId !== cmd[2]) { state.actorId = cmd[2]; status(); }
        }
    }

    /* ---------------- 收帧 ---------------- */

    // 返回 true 表示整帧都是我们的，要拦下来
    function onIncoming(raw) {
        var pkt = parseFrame(raw);
        if (!pkt) return false;

        // 最近收到的帧类型（排查用）
        state.recent = state.recent || [];
        state.recent.push(pkt.name + '(' + String(raw).length + ')');
        if (state.recent.length > 12) state.recent.shift();

        if (pkt.name === 'join_ack') { learnFromJoinAck(pkt.args[0]); return false; }

        // 房间在线成员：带上真实昵称和头像（我们的名字就来自这里）
        if (pkt.name === 'svr_user_status_change') {
            var list = pkt.args[0];
            if (!Array.isArray(list)) list = [list];
            list.forEach(learnUser);
            return false;
        }

        if (pkt.name === 'operation_ack') {
            var a = pkt.args[0] || {};
            state.acks++;
            state.lastAck = { code: a.code, t: Date.now() };
            if (a.user_id) learnSelfId(a.user_id);   // 回执里带着「我」的协作 id
            toUI({ type: 'CM_ACK', code: a.code });

            var pend = state.pendingChat;
            if (a.code === 1) {
                state.pendingChat = null;
            } else if (pend && !pend.retried) {
                // 版本号被编辑器抢先了：等一下换新版本号重试一次
                pend.retried = true;
                setTimeout(function () {
                    try { sendCommand(pend.cmd); toUI({ type: 'CM_RETRY' }); } catch (e) {}
                }, 700);
            }
            return false;
        }

        if (pkt.name !== 'operation_relay') return false;

        var payload = pkt.args[0];
        if (!payload || !Array.isArray(payload.op)) return false;

        state.framesIn++;
        var cmds = flattenOps(payload.op);
        var mineCount = 0, hits = [];

        cmds.forEach(function (cmd) {
            learnFromOp(cmd);
            var info = inspectComment(cmd);
            if (info) { mineCount++; if (info.kind === 'create') hits.push(info); }
        });

        hits.forEach(function (hit) {
            var body = null;
            try { body = JSON.parse(hit.text); } catch (e) { body = null; }
            if (!body || typeof body !== 'object') return;
            if (body.c && body.c === state.clientId) return;          // 自己的回声
            if (body.id && seen[body.id]) return;                     // 重复包
            if (body.id) {
                seen[body.id] = 1;
                if (++seenN > 500) { seen = Object.create(null); seenN = 0; }
            }
            state.msgIn++;
            // 昵称优先用在线状态里的真名（发送方本地名可能还是占位）
            var uid = Number(body.u) || 0;
            var known = uid && state.users[uid] ? state.users[uid].n : '';
            var nick = known || String(body.n || '对方');
            log('📩', nick + ': ' + body.t);
            var img = typeof body.img === 'string' && /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.img)
                ? body.img : '';
            var mentions = Array.isArray(body.mentions)
                ? body.mentions.map(Number).filter(function (x) { return !!x; }).slice(0, 20) : [];
            var ava = (uid && state.users[uid] && state.users[uid].a) || '';
            // 同一次连发的多张图共用 g（组号），gi/gt 是序号和总数，UI 端合并成同一个气泡
            var gid = typeof body.g === 'string' && body.g ? body.g.slice(0, 24) : '';
            toUI({
                type: 'CM_RECEIVE',
                m: {
                    id: String(body.id || ''),
                    nickname: nick,
                    uid: uid || 0,
                    avatar: ava,
                    text: String(body.t == null ? '' : body.t),
                    img: img,
                    mentions: mentions,
                    gid: gid,
                    gi: gid ? (Number(body.gi) || 0) : 0,
                    gt: gid ? Math.max(1, Math.min(20, Number(body.gt) || 1)) : 1,
                    ts: Number(body.ts) || Date.now()
                }
            });
            status();
        });

        // 只有当整帧都是我们造的注释时才拦截，避免误伤同帧里别人的操作
        return mineCount > 0 && mineCount === cmds.length;
    }

    /* ---------------- 发送 ---------------- */

    // 注意：revision 必须严格比当前文档版本大 1，跳变会被服务器以 code=10000000 拒绝
    function nextRevision() {
        state.revision = (state.revision || 0) + 1;
        return state.revision;
    }

    function sendRaw(cmd) {
        if (!socket || socket.readyState !== 1) throw new Error('协作连接未就绪');
        var frame = '42' + JSON.stringify(['operation', {
            revision: nextRevision(),
            op: [[cmd]],
            lock: []
        }]);
        // 自己发的帧不算「编辑器在写」，否则连发两条会被自己的静默窗口挡住
        state.selfSending = true;
        try { socket.send(frame); } finally { state.selfSending = false; }
    }

    function sendCommand(cmd) {
        if (!state.actorId) throw new Error('还没拿到角色信息，请稍后再试');
        sendRaw(cmd);
    }

    /* 历史残留清理：以前测试留下的带暗号注释会随文档一起加载出来，
     * 这里在进房后顺手删掉（只删正文以暗号开头的，最多 12 条，慢慢删）。 */
    function sweepLegacy(doc) {
        if (state.swept) return;
        state.swept = true;
        try {
            var t = doc && doc.theatre;
            var actorsMap = t && t.actors;
            if (!actorsMap || typeof actorsMap !== 'object' || Array.isArray(actorsMap)) return;
            var found = [];
            Object.keys(actorsMap).forEach(function (aid) {
                var bd = (actorsMap[aid] || {}).block_data_json;
                var comments = bd && bd.comments;
                if (!comments || typeof comments !== 'object') return;
                Object.keys(comments).forEach(function (cid) {
                    var it = comments[cid];
                    if (it && typeof it.text === 'string' && it.text.indexOf(PREFIX) === 0) {
                        found.push({ actorId: aid, cid: cid });
                    }
                });
            });
            if (!found.length) return;
            state.legacyFound = found.length;
            log('🧹 发现 ' + found.length + ' 条历史残留，稍后清理');
            found.slice(0, 12).forEach(function (item, i) {
                setTimeout(function () {
                    try {
                        sendRaw(['theatre', 'actors', item.actorId, 'block_data_json', 'comments', item.cid, { r: true }]);
                    } catch (e) {}
                }, 1200 + i * 500);
            });
        } catch (e) { state.lastError = 'sweep: ' + e.message; }
    }

    // 注释路径：可带任意多个尾部字段（如 'text',{r,i} 或 {r:true}）
    function commentCmd(cid) {
        var base = ['theatre', 'actors', state.actorId, 'block_data_json', 'comments', cid];
        return base.concat([].slice.call(arguments, 1));
    }

    function sendChat(text, nickname, reqId, extra, tries) {
        extra = extra || {};
        tries = tries || 0;
        try {
            if (!socket || socket.readyState !== 1) throw new Error('协作连接还没建立，请确认已进入多人编辑');

            // 角色 ID 正常在 join_ack 里就学到了；这里兜底再扒一次文档，
            // 还是拿不到就等它一会儿（项目结构可能还没同步完），不要求用户做任何操作。
            if (!state.actorId) {
                var fromDoc = pickActorId(state.doc);
                if (fromDoc) state.actorId = fromDoc;
            }
            if (!state.actorId) {
                if (tries < 8) { setTimeout(function () { sendChat(text, nickname, reqId, extra, tries + 1); }, 350); return; }
                throw new Error('项目结构还没同步完，稍等两秒再发一次');
            }

            // 编辑器正在写的时候插队容易撞版本号，等它安静一下再发
            var quiet = 300 - (Date.now() - (state.lastAppOpAt || 0));
            if (quiet > 0 && tries < 40) {
                setTimeout(function () { sendChat(text, nickname, reqId, extra, tries + 1); }, quiet + 30);
                return;
            }

            var img = String(extra.img || '');
            if (img && !/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) {
                throw new Error('图片格式不支持');
            }
            if (img && img.length > 55000) throw new Error('图片太大，换一张小一点儿的');

            var cid = 'chat_' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
            var body = { v: 1, id: cid, c: state.clientId, u: state.userId || 0,
                n: state.selfName || nickname || '匿名', t: text, ts: Date.now() };
            if (img) body.img = img;
            if (extra.gid) {
                // 分组：一次选多张图时拆成多条协议消息，但用同一个组号，接收端会拼回一个气泡
                body.g = String(extra.gid).slice(0, 24);
                body.gi = Number(extra.gi) || 0;
                body.gt = Math.max(1, Math.min(20, Number(extra.gt) || 1));
            }
            if (Array.isArray(extra.mentions) && extra.mentions.length) {
                body.mentions = extra.mentions.map(Number).filter(function (x) { return !!x; }).slice(0, 20);
            }
            var full = PREFIX + JSON.stringify(body);
            if (full.length > 60000) throw new Error('这条消息太长，图片请换小一点');

            // 只发一条 op：建注释时正文已经带上，少一次版本号自增就少一次和编辑器撞车的概率
            var cmd = commentCmd(cid, {
                i: {
                    id: cid,
                    parent_id: null,
                    text: full,
                    pinned: false,
                    size: COMMENT_SIZE.slice(),
                    location: COMMENT_LOCATION.slice(),
                    auto_layout: false,
                    color_theme: 'BLUE'
                }
            });
            state.pendingChat = { cid: cid, cmd: cmd, retried: false };
            sendCommand(cmd);

            state.msgOut++;
            // 控制台发送日志：文字 / 图片大小 / 组号帧序 / @ 谁，一帧一行
            var sentBits = [];
            if (text) sentBits.push(text.length > 30 ? ('「' + text.slice(0, 30) + '…」') : ('「' + text + '」'));
            if (img) sentBits.push('图片 ' + Math.max(1, Math.round(img.length / 1024)) + 'KB');
            if (body.g) sentBits.push('组 ' + body.g + ' ' + ((body.gi || 0) + 1) + '/' + body.gt);
            if (body.mentions) sentBits.push('@' + body.mentions.join(','));
            log('📤 已发送 ' + cid.slice(-5), sentBits.join(' · ') || '「空」');
            toUI({ type: 'CM_SENT', reqId: reqId, ok: true, cid: cid });
            status();

            // 3) 阅后即焚：编辑器安静后再删，删失败补一次
            var burn = function (attempt) {
                return function () {
                    var wait = 300 - (Date.now() - (state.lastAppOpAt || 0));
                    if (wait > 0) { setTimeout(burn(attempt), wait + 30); return; }
                    try {
                        if (socket && socket.readyState === 1) sendCommand(commentCmd(cid, { r: true }));
                    } catch (e) {
                        if (attempt < 1) setTimeout(burn(attempt + 1), 800);
                    }
                };
            };
            setTimeout(burn(0), KEEP_MS);
        } catch (e) {
            state.lastError = e.message;
            log('⚠️ 发送失败', e.message);
            toUI({ type: 'CM_SENT', reqId: reqId, ok: false, error: e.message });
        }
    }

    /* ---------------- 接管 WebSocket ---------------- */

    function attach(ws, url) {
        socket = ws;
        window.__cmChatSocket = ws;     // 调试用：控制台可直接看/复放
        state.connected = ws.readyState === 1;
        var m = /work_id=(\d+)/.exec(url);
        if (m) state.roomId = m[1];

        ws.addEventListener('message', function (ev) {
            var block = false;
            try { block = onIncoming(ev.data); } catch (e) { state.lastError = 'in: ' + e.message; }
            if (block) ev.stopImmediatePropagation();   // 关键：不给 Blockly 渲染的机会
        });
        ws.addEventListener('open', function () {
            state.connected = true; log('🔌 协作连接已打开'); status();
        });
        ws.addEventListener('close', function () {
            state.connected = false; log('🔌 协作连接已关闭'); status();
        });

        // 从页面自己的操作里学 actorId / revision（比自己造一个更稳）
        var rawSend = ws.send;
        try {
            ws.send = function (data) {
                try {
                    var pkt = parseFrame(data);
                    if (pkt && pkt.name === 'operation' && pkt.args[0]) {
                        if (typeof pkt.args[0].revision === 'number') {
                            state.revision = Math.max(state.revision, pkt.args[0].revision);
                        }
                        if (!state.selfSending) state.lastAppOpAt = Date.now();   // 编辑器正在写，别在这时候插队
                        flattenOps(pkt.args[0].op).forEach(learnFromOp);
                    }
                } catch (e) {}
                return rawSend.apply(ws, arguments);
            };
        } catch (e) {}

        log('✅ 已接管协作连接' + (state.roomId ? '（房间 ' + state.roomId + '）' : ''));
        status();
    }

    function PatchedWebSocket(url, protocols) {
        var ws = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
        try {
            if (String(url).indexOf(COLLAB_HOST) !== -1) attach(ws, String(url));
        } catch (e) { state.lastError = 'attach: ' + e.message; }
        return ws;
    }
    PatchedWebSocket.prototype = NativeWebSocket.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) {
        try { PatchedWebSocket[k] = NativeWebSocket[k]; } catch (e) {}
    });
    try { Object.defineProperty(PatchedWebSocket, 'name', { value: 'WebSocket' }); } catch (e) {}
    window.WebSocket = PatchedWebSocket;

    /* ---------------- UI → Inject ---------------- */

    window.addEventListener('message', function (ev) {
        if (ev.source && ev.source !== window) return;
        var d = ev.data;
        if (!d || typeof d !== 'object' || !d.type) return;
        if (d.type === 'CM_SEND') {
            sendChat(String(d.text || ''), String(d.nickname || '匿名'), d.reqId, {
                img: d.img || '',
                mentions: d.mentions || [],
                gid: d.gid || '',
                gi: d.gi || 0,
                gt: d.gt || 1
            });
        }
        else if (d.type === 'CM_PING') { status(); identity(); }
    });

    log('v' + VERSION + ' 已就绪，暗号 ' + PREFIX.replace(/\n/g, '\\n'));
})();
