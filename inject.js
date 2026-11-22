














(function () {
    'use strict';
    if (window.__cmChatInstalled) return;
    window.__cmChatInstalled = true;

    var VERSION = '4.0';
    var PREFIX = '#%^&114514*/n';     
    var COLLAB_HOST = 'socketcoll.codemao.cn';
    var COMMENT_LOCATION = [100, 100]; 
    var COMMENT_SIZE = [140, 48];
    var KEEP_MS = 1500;                
    var NativeWebSocket = window.WebSocket;

    var state = {
        version: VERSION,
        clientId: 'c' + Math.random().toString(36).slice(2, 10),
        connected: false,
        roomId: null,
        actorId: null,
        sceneId: null,
        userId: null,       
        selfName: null,     
        revision: 1,
        framesIn: 0,
        msgIn: 0,
        msgOut: 0,
        acks: 0,
        lastAck: null,
        lastError: null
    };
    state.users = Object.create(null);   
    window.__cmChatDebug = state;   

    var seen = Object.create(null);
    var seenN = 0;
    var socket = null;

    

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
        if (changed) identity();     
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

    
    function flattenOps(op) {
        var out = [];
        (function walk(node) {
            if (!Array.isArray(node)) return;
            if (typeof node[0] === 'string') { out.push(node); return; }
            node.forEach(walk);
        })(op);
        return out;
    }

    
    function inspectComment(cmd) {
        var i = cmd.indexOf('comments');
        if (i < 0 || cmd[0] !== 'theatre') return null;
        var cid = cmd[i + 1];
        var action = cmd[i + 2];
        if (typeof cid !== 'string' || !action || typeof action !== 'object') return null;
        var isOurs = cid.indexOf('chat_') === 0;

        if (action.i && typeof action.i === 'object' && typeof action.i.text === 'string') {
            if (action.i.text.indexOf(PREFIX) !== 0) return null;   
            return { kind: 'create', cid: cid, text: action.i.text.slice(PREFIX.length) };
        }
        if (action.r === true && isOurs) return { kind: 'delete', cid: cid };
        return null;
    }

    

    



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

            
            if (!list.length) {
                Object.keys(theatre.scenes || {}).forEach(function (k) {
                    var a = (theatre.scenes[k] || {}).actors;
                    if (Array.isArray(a)) a.forEach(function (id) { push(id, 'any-scene'); });
                    else if (a && typeof a === 'object') Object.keys(a).forEach(function (id) { push(id, 'any-scene'); });
                });
            }
            if (!list.length) return null;

            
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

            
            state.doc = d.doc;

            
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

    

    
    function onIncoming(raw) {
        var pkt = parseFrame(raw);
        if (!pkt) return false;

        
        state.recent = state.recent || [];
        state.recent.push(pkt.name + '(' + String(raw).length + ')');
        if (state.recent.length > 12) state.recent.shift();

        if (pkt.name === 'join_ack') { learnFromJoinAck(pkt.args[0]); return false; }

        
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
            if (a.user_id) learnSelfId(a.user_id);   
            toUI({ type: 'CM_ACK', code: a.code });

            var pend = state.pendingChat;
            if (a.code === 1) {
                state.pendingChat = null;
            } else if (pend && !pend.retried) {
                
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
            if (body.c && body.c === state.clientId) return;          
            if (body.id && seen[body.id]) return;                     
            if (body.id) {
                seen[body.id] = 1;
                if (++seenN > 500) { seen = Object.create(null); seenN = 0; }
            }
            state.msgIn++;
            
            var uid = Number(body.u) || 0;
            var known = uid && state.users[uid] ? state.users[uid].n : '';
            var nick = known || String(body.n || '对方');
            var img = typeof body.img === 'string' && /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.img)
                ? body.img : '';
            var mentions = Array.isArray(body.mentions)
                ? body.mentions.map(Number).filter(function (x) { return !!x; }).slice(0, 20) : [];
            var ava = (uid && state.users[uid] && state.users[uid].a) || '';
            
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

        
        return mineCount > 0 && mineCount === cmds.length;
    }

    

    
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
        
        state.selfSending = true;
        try { socket.send(frame); } finally { state.selfSending = false; }
    }

    function sendCommand(cmd) {
        if (!state.actorId) throw new Error('还没拿到角色信息，请稍后再试');
        sendRaw(cmd);
    }

    

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
            found.slice(0, 12).forEach(function (item, i) {
                setTimeout(function () {
                    try {
                        sendRaw(['theatre', 'actors', item.actorId, 'block_data_json', 'comments', item.cid, { r: true }]);
                    } catch (e) {}
                }, 1200 + i * 500);
            });
        } catch (e) { state.lastError = 'sweep: ' + e.message; }
    }

    
    function commentCmd(cid) {
        var base = ['theatre', 'actors', state.actorId, 'block_data_json', 'comments', cid];
        return base.concat([].slice.call(arguments, 1));
    }

    function sendChat(text, nickname, reqId, extra, tries) {
        extra = extra || {};
        tries = tries || 0;
        try {
            if (!socket || socket.readyState !== 1) throw new Error('协作连接还没建立，请确认已进入多人编辑');

            
            
            if (!state.actorId) {
                var fromDoc = pickActorId(state.doc);
                if (fromDoc) state.actorId = fromDoc;
            }
            if (!state.actorId) {
                if (tries < 8) { setTimeout(function () { sendChat(text, nickname, reqId, extra, tries + 1); }, 350); return; }
                throw new Error('项目结构还没同步完，稍等两秒再发一次');
            }

            
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
                
                body.g = String(extra.gid).slice(0, 24);
                body.gi = Number(extra.gi) || 0;
                body.gt = Math.max(1, Math.min(20, Number(extra.gt) || 1));
            }
            if (Array.isArray(extra.mentions) && extra.mentions.length) {
                body.mentions = extra.mentions.map(Number).filter(function (x) { return !!x; }).slice(0, 20);
            }
            var full = PREFIX + JSON.stringify(body);
            if (full.length > 60000) throw new Error('这条消息太长，图片请换小一点');

            
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
            toUI({ type: 'CM_SENT', reqId: reqId, ok: true, cid: cid });
            status();

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
            toUI({ type: 'CM_SENT', reqId: reqId, ok: false, error: e.message });
        }
    }

    

    function attach(ws, url) {
        socket = ws;
        window.__cmChatSocket = ws;     
        state.connected = ws.readyState === 1;
        var m = /work_id=(\d+)/.exec(url);
        if (m) state.roomId = m[1];

        ws.addEventListener('message', function (ev) {
            var block = false;
            try { block = onIncoming(ev.data); } catch (e) { state.lastError = 'in: ' + e.message; }
            if (block) ev.stopImmediatePropagation();   
        });
        ws.addEventListener('open', function () {
            state.connected = true; status();
        });
        ws.addEventListener('close', function () {
            state.connected = false; status();
        });

        
        var rawSend = ws.send;
        try {
            ws.send = function (data) {
                try {
                    var pkt = parseFrame(data);
                    if (pkt && pkt.name === 'operation' && pkt.args[0]) {
                        if (typeof pkt.args[0].revision === 'number') {
                            state.revision = Math.max(state.revision, pkt.args[0].revision);
                        }
                        if (!state.selfSending) state.lastAppOpAt = Date.now();   
                        flattenOps(pkt.args[0].op).forEach(learnFromOp);
                    }
                } catch (e) {}
                return rawSend.apply(ws, arguments);
            };
        } catch (e) {}

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

})();
