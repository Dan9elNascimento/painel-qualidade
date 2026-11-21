/* Painel Qualidade — roda na página do WMS: carrega o painel (sempre a versão mais nova) e cria a "ponte" com a extensão. */
(function () {
  if (window.top !== window) return;
  var PAINEL_JS = 'https://dan9elnascimento.github.io/painel-qualidade/painel.js';
  window.__painelApp = 'ext-1.0.0';
  window.painelPonte = function (json) { window.postMessage({ __painelQ: 'pedido', json: json }, location.origin); };
  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__painelQ !== 'resposta') return;
    if (window.__painelResposta) window.__painelResposta(e.data.id, e.data.ok, e.data.json);
  });
  function carregar() {
    if (document.getElementById('painel-qualidade-raiz') || document.getElementById('painel-qualidade-js')) return;
    var s = document.createElement('script');
    s.id = 'painel-qualidade-js'; s.charset = 'utf-8'; s.src = PAINEL_JS + '?v=' + Date.now();
    (document.head || document.documentElement).appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', carregar); else carregar();
})();
