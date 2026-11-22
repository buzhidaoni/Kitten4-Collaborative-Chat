var SITE = '*://kitten4.codemao.cn/*';

function showRefreshTip(reason) {
    var text = reason === 'update'
        ? '协作聊天已更新到新版本，请刷新本页让新版本生效。'
        : '协作聊天已装好，请刷新本页一次，聊天球就会出现。';
    chrome.tabs.query({ url: SITE }, function (tabs) {
        (tabs || []).forEach(function (t) {
            chrome.scripting.executeScript({
                target: { tabId: t.id },
                func: function (msg) {
                    try {
                        if (document.getElementById('cmc-refresh-tip')) {
                            document.getElementById('cmc-refresh-tip').remove();
                        }
                        var box = document.createElement('div');
                        box.id = 'cmc-refresh-tip';
                        box.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:14px;max-width:min(420px,calc(100vw - 32px));padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.9);-webkit-backdrop-filter:blur(20px) saturate(1);backdrop-filter:blur(20px) saturate(1);border:1px solid rgba(255,255,255,.85);box-shadow:0 16px 44px -18px rgba(45,45,45,.5);font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#15171b;';
                        var dot = document.createElement('span');
                        dot.style.cssText = 'flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:#ff8b39;box-shadow:0 0 0 4px rgba(255,139,57,.18);';
                        var txt = document.createElement('span');
                        txt.textContent = msg;
                        var btn = document.createElement('button');
                        btn.textContent = '刷新页面';
                        btn.style.cssText = 'flex:0 0 auto;padding:6px 13px;border:0;border-radius:9px;background:#ff9d55;color:#3a1d05;font:700 12px/1.4 inherit;cursor:pointer;';
                        btn.onclick = function () { location.reload(); };
                        var close = document.createElement('button');
                        close.textContent = '×';
                        close.style.cssText = 'flex:0 0 auto;width:22px;height:22px;border:0;border-radius:7px;background:rgba(0,0,0,.05);color:#45474d;font:16px/1 inherit;cursor:pointer;';
                        close.onclick = function () { box.remove(); };
                        box.appendChild(dot); box.appendChild(txt); box.appendChild(btn); box.appendChild(close);
                        (document.body || document.documentElement).appendChild(box);
                    } catch (e) {}
                },
                args: [text]
            }, function () {});
        });
    });
}

chrome.runtime.onInstalled.addListener(function (d) {
    showRefreshTip(d && d.reason === 'update' ? 'update' : 'install');
});
