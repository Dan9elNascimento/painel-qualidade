"""Painel Qualidade — app
Abre uma janela do Chrome (ou Edge) própria do painel, já com o WMS e o Painel Qualidade
carregado sozinho (sem favorito). Faz a "ponte" entre sites: o painel do WMS pode pedir dados
do Cubiscan (Google) sem você abrir outra aba.

- Login: na primeira vez, faça login no WMS e (quando pedir) no Google nessa janela. Fica salvo.
- Nenhuma senha é guardada pelo app: os logins ficam só no navegador, como sempre.
- Usa só Python padrão (sem pip)."""
import json
import os
import queue
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import base64

VERSAO = "1.1.0"
PORTA = int(os.environ.get("PAINEL_PORTA", "9333"))
WMS_URL = os.environ.get("PAINEL_WMS_URL", "https://wms.ssc.shopee.com.br/")
WMS_HOST = urllib.parse.urlparse(WMS_URL).hostname
PAINEL_JS = os.environ.get("PAINEL_JS_URL", "https://dan9elnascimento.github.io/painel-qualidade/painel.js")
CUB_URL = os.environ.get("PAINEL_CUB_URL", "https://script.google.com/a/shopee.com/macros/s/AKfycbzfv3G8biAdsTp5DMWptXOwDgrMFwCCbAb50LQ72Hogbvj0A1wXpQB1uzYbN5M1gTEk/exec?page=cubscan")
BASE = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "PainelQualidade")
PERFIL = os.path.join(BASE, "perfil")
LOG = os.path.join(BASE, "painel.log")

NAVEGADORES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium",
]


def log(msg):
    linha = f"[{time.strftime('%H:%M:%S')}] {msg}"
    try:
        print(linha, flush=True)
    except Exception:
        pass
    try:
        os.makedirs(BASE, exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(linha + "\n")
    except OSError:
        pass


def aviso_erro(msg):
    log("ERRO: " + msg)
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, msg, "Painel Qualidade", 0x10)
            return
        except Exception:
            pass
    print(msg, file=sys.stderr)


# ---------------- WebSocket mínimo ----------------
class WS:
    def __init__(self, url):
        u = urllib.parse.urlparse(url)
        self.s = socket.create_connection((u.hostname, u.port), timeout=30)
        chave = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {chave}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            p = self.s.recv(4096)
            if not p:
                raise ConnectionError("navegador recusou a conexão")
            resp += p
        if b" 101 " not in resp.split(b"\r\n", 1)[0]:
            raise ConnectionError(resp.split(b"\r\n", 1)[0].decode(errors="ignore"))
        self.buf = resp.split(b"\r\n\r\n", 1)[1]
        self.s.settimeout(None)
        self.trava = threading.Lock()

    def _ler(self, n):
        while len(self.buf) < n:
            p = self.s.recv(1 << 20)
            if not p:
                raise ConnectionError("conexão fechada")
            self.buf += p
        d, self.buf = self.buf[:n], self.buf[n:]
        return d

    def enviar(self, texto):
        dados = texto.encode()
        cab = bytearray([0x81])
        n = len(dados)
        if n < 126:
            cab.append(0x80 | n)
        elif n < 65536:
            cab.append(0x80 | 126)
            cab += struct.pack(">H", n)
        else:
            cab.append(0x80 | 127)
            cab += struct.pack(">Q", n)
        m = os.urandom(4)
        cab += m
        corpo = bytearray(dados)
        for i in range(n):
            corpo[i] ^= m[i & 3]
        with self.trava:
            self.s.sendall(bytes(cab) + bytes(corpo))

    def receber(self):
        msg = b""
        while True:
            b1, b2 = self._ler(2)
            op, n = b1 & 0x0F, b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._ler(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._ler(8))[0]
            if b2 & 0x80:
                self._ler(4)
            d = self._ler(n)
            if op == 8:
                raise ConnectionError("navegador fechado")
            if op in (9, 10):
                continue
            msg += d
            if b1 & 0x80:
                return msg.decode("utf-8")


# ---------------- Conexão com o navegador (DevTools Protocol) ----------------
class Navegador:
    def __init__(self, url_ws):
        self.ws = WS(url_ws)
        self.id = 0
        self.esperando = {}
        self.trava = threading.Lock()
        self.eventos = queue.Queue()
        self.vivo = True
        threading.Thread(target=self._leitor, daemon=True).start()

    def _leitor(self):
        try:
            while True:
                m = json.loads(self.ws.receber())
                if "id" in m:
                    ev = self.esperando.pop(m["id"], None)
                    if ev:
                        ev[1] = m
                        ev[0].set()
                else:
                    self.eventos.put(m)
        except Exception as e:
            log(f"Conexão com o navegador encerrada ({e}).")
        self.vivo = False
        self.eventos.put(None)
        for ev in list(self.esperando.values()):
            ev[0].set()

    def cmd(self, metodo, params=None, sessao=None, timeout=120):
        with self.trava:
            self.id += 1
            meu = self.id
        ev = [threading.Event(), None]
        self.esperando[meu] = ev
        m = {"id": meu, "method": metodo, "params": params or {}}
        if sessao:
            m["sessionId"] = sessao
        self.ws.enviar(json.dumps(m))
        if not ev[0].wait(timeout) or ev[1] is None:
            self.esperando.pop(meu, None)
            raise TimeoutError(f"{metodo} não respondeu")
        if "error" in ev[1]:
            raise RuntimeError(ev[1]["error"].get("message", "erro"))
        return ev[1].get("result", {})

    def js(self, sessao, codigo, timeout=120):
        r = self.cmd("Runtime.evaluate", {"expression": codigo, "awaitPromise": True, "returnByValue": True,
                                          "timeout": timeout * 1000}, sessao, timeout + 5)
        if r.get("exceptionDetails"):
            d = r["exceptionDetails"]
            raise RuntimeError((d.get("exception") or {}).get("description") or d.get("text") or "erro no navegador")
        return (r.get("result") or {}).get("value")


def http_json(caminho, metodo="GET"):
    req = urllib.request.Request(f"http://127.0.0.1:{PORTA}{caminho}", method=metodo)
    with urllib.request.urlopen(req, timeout=3) as r:
        return json.loads(r.read().decode())


def navegador_no_ar():
    try:
        return http_json("/json/version")
    except Exception:
        return None


def abrir_navegador():
    exe = next((e for e in NAVEGADORES if os.path.exists(e)), None)
    if not exe:
        raise RuntimeError("Não achei o Google Chrome nem o Microsoft Edge neste computador.")
    os.makedirs(PERFIL, exist_ok=True)
    args = [exe, f"--remote-debugging-port={PORTA}", f"--user-data-dir={PERFIL}", "--no-first-run",
            "--no-default-browser-check", "--remote-allow-origins=http://127.0.0.1", WMS_URL]
    if os.environ.get("PAINEL_HEADLESS"):
        args[1:1] = ["--headless=new", "--no-sandbox"]
    subprocess.Popen(args)
    for _ in range(60):
        time.sleep(0.25)
        v = navegador_no_ar()
        if v:
            return v
    raise RuntimeError("O navegador abriu, mas não liberou o controle do painel.\n"
                       "Pode ser bloqueio da TI (política 'RemoteDebuggingAllowed').")


# Script colocado em toda página: carrega o painel quando for o WMS (abre minimizado).
INJETAR = ("(function(){try{if(window.top!==window||location.hostname!==%s)return;window.__painelApp=%s;"
           "function go(){if(document.getElementById('painel-qualidade-raiz'))return;var s=document.createElement('script');"
           "s.charset='utf-8';s.src=%s+'?v='+Date.now();(document.head||document.documentElement).appendChild(s);}"
           "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();}catch(e){}})()"
           ) % (json.dumps(WMS_HOST), json.dumps(VERSAO), json.dumps(PAINEL_JS))

# Roda dentro da aba do Cubiscan: acha o token da página e pede o backlog (mesma chamada que a página faz).
CUBISCAN_JS = r"""(async function(whs){
  if (document.readyState !== 'complete') return JSON.stringify({pronto:false});
  if (location.hostname !== __HOST__) {
    // Passagem pelo Google (redirecionamento) é normal; só é login de verdade se a tela pede e-mail/senha.
    var pedeLogin = /accounts\.google\./.test(location.hostname) && !!document.querySelector('input[type=email],input[type=password]');
    return JSON.stringify({login: pedeLogin, pronto:false, info:'em ' + location.hostname});
  }
  var html = document.documentElement.innerHTML, achados = [], m, res = [
    /token["']?\s*[:=,]\s*["']([A-Za-z0-9_\-:]{20,90})["']/g, /["'](AM[A-Za-z0-9_\-]{8,}:\d{10,})["']/g, /["'](A[A-Za-z0-9_\-]{30,50})["']/g];
  res.forEach(function(re){ while ((m = re.exec(html))) if (achados.indexOf(m[1]) < 0) achados.push(m[1]); });
  if (!achados.length) return JSON.stringify({pronto:false, info:'página sem token ainda'});
  var status = [];
  var base = location.pathname.replace(/\/(exec|dev)$/, '/callback');
  var corpo = 'request=' + encodeURIComponent(JSON.stringify(['getCubbingItemsClient', JSON.stringify([{nb:'backlog', whs:whs}]), null, [0], null, null, 1, 0]));
  for (var i = 0; i < Math.min(achados.length, 40); i++) {
    try {
      var r = await fetch(base + '?nocache_id=' + (Date.now() % 100000) + '&token=' + encodeURIComponent(achados[i]), {method:'POST', credentials:'include', body:corpo,
        headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8','x-same-domain':'1'}});
      status.push(r.status);
      if (!r.ok) continue;
      var t = await r.text(); t = t.slice(t.indexOf('\n') + 1);
      var j = JSON.parse(t), bruto = j && j[0] && j[0][1] && j[0][1][1];
      if (typeof bruto !== 'string') continue;
      var d = JSON.parse(bruto);
      if (d && d.rows) return JSON.stringify({ok:true, rows:d.rows, lastUpdate:d.lastUpdate || ''});
    } catch (e) {}
  }
  return JSON.stringify({falhou:true, info:'tokens=' + achados.length + ' status=' + status.slice(0, 8).join(',')});
})(__WHS__)"""


class App:
    def __init__(self, nav):
        self.nav = nav
        self.sessoes = {}      # targetId -> sessionId
        self.ajudantes = set() # abas abertas pelo app (Cubiscan)

    def iniciar(self):
        self.nav.cmd("Target.setDiscoverTargets", {"discover": True})
        for t in self.nav.cmd("Target.getTargets").get("targetInfos", []):
            self.anexar(t)
        threading.Thread(target=self.laco_eventos, daemon=True).start()

    def anexar(self, info):
        tid = info.get("targetId")
        if info.get("type") != "page" or tid in self.sessoes or tid in self.ajudantes:
            return
        try:
            s = self.nav.cmd("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
            self.sessoes[tid] = s
            self.nav.cmd("Runtime.enable", {}, s)
            self.nav.cmd("Runtime.addBinding", {"name": "painelPonte"}, s)
            self.nav.cmd("Page.enable", {}, s)
            self.nav.cmd("Page.addScriptToEvaluateOnNewDocument", {"source": INJETAR}, s)
            self.nav.cmd("Runtime.evaluate", {"expression": INJETAR}, s)
        except Exception as e:
            log(f"Não consegui preparar a aba: {e}")

    def laco_eventos(self):
        while True:
            m = self.nav.eventos.get()
            if m is None:
                return
            met, p = m.get("method"), m.get("params", {})
            if met == "Target.targetCreated":
                self.anexar(p.get("targetInfo", {}))
            elif met == "Target.targetDestroyed":
                self.sessoes.pop(p.get("targetId"), None)
            elif met == "Runtime.executionContextCreated":
                ctx = p.get("context", {})
                if (ctx.get("auxData") or {}).get("isDefault") and m.get("sessionId"):
                    threading.Thread(target=self.religar, args=(m["sessionId"],), daemon=True).start()
            elif met == "Runtime.bindingCalled" and p.get("name") == "painelPonte":
                threading.Thread(target=self.atender, args=(m.get("sessionId"), p.get("payload", "")), daemon=True).start()

    def religar(self, sessao):
        try:
            self.nav.cmd("Runtime.addBinding", {"name": "painelPonte"}, sessao)
        except Exception:
            pass

    def responder(self, sessao, pid, ok, dados):
        try:
            self.nav.cmd("Runtime.evaluate", {"expression": "window.__painelResposta&&window.__painelResposta(%s,%s,%s)" % (
                json.dumps(pid), "true" if ok else "false", json.dumps(json.dumps(dados)))}, sessao)
        except Exception as e:
            log(f"Não consegui responder ao painel: {e}")

    def atender(self, sessao, payload):
        try:
            pedido = json.loads(payload)
        except ValueError:
            return
        pid, acao = pedido.get("id"), pedido.get("acao")
        try:
            if acao == "ping":
                return self.responder(sessao, pid, True, {"versao": VERSAO})
            if acao == "cubiscan":
                return self.responder(sessao, pid, True, self.cubiscan(pedido.get("whs") or "BRFPE1"))
            raise RuntimeError("Ação desconhecida: " + str(acao))
        except Exception as e:
            log(f"Erro em {acao}: {e}")
            self.responder(sessao, pid, False, {"erro": str(e)})

    def cubiscan(self, whs):
        log("Cubiscan: abrindo a página em segundo plano…")
        tid = self.nav.cmd("Target.createTarget", {"url": CUB_URL, "background": True})["targetId"]
        self.ajudantes.add(tid)
        manter_aberta = False
        try:
            s = self.nav.cmd("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
            codigo = CUBISCAN_JS.replace('__WHS__', json.dumps(whs)).replace('__HOST__', json.dumps(urllib.parse.urlparse(CUB_URL).hostname))
            fim, logins, ultimo = time.time() + 120, 0, "página ainda carregando"
            while time.time() < fim:
                time.sleep(1.5)
                try:
                    r = json.loads(self.nav.js(s, codigo, timeout=60) or "{}")
                except Exception as e:
                    ultimo = f"página carregando ({str(e)[:80]})"
                    continue
                if r.get("ok"):
                    log(f"Cubiscan: {len(r['rows'])} linhas recebidas.")
                    return {"rows": r["rows"], "lastUpdate": r.get("lastUpdate", "")}
                # Só pede login se ficar parado na tela de login do Google (~7s); passagem rápida é normal.
                logins = logins + 1 if r.get("login") else 0
                if logins >= 5:
                    manter_aberta = True
                    self.nav.cmd("Target.activateTarget", {"targetId": tid})
                    raise RuntimeError("Faça login na sua conta Google da Shopee na aba que abriu e clique de novo em Montar lotes.")
                if r.get("info") and r.get("info") != ultimo:
                    ultimo = r["info"]
                    log(f"Cubiscan: {ultimo}")
            raise RuntimeError(f"O Cubiscan não respondeu a tempo ({ultimo}). Me mande o arquivo painel.log para eu ver.")
        finally:
            if not manter_aberta:
                try:
                    self.nav.cmd("Target.closeTarget", {"targetId": tid})
                except Exception:
                    pass
            self.ajudantes.discard(tid)


def principal():
    log(f"Painel Qualidade app v{VERSAO}")
    # Só um app por vez: se já estiver rodando, só abre outra aba do WMS.
    trava = socket.socket()
    try:
        trava.bind(("127.0.0.1", PORTA + 1))
    except OSError:
        try:
            http_json("/json/new?" + urllib.parse.quote(WMS_URL, safe=""), "PUT")
        except Exception:
            pass
        return
    versao = navegador_no_ar() or abrir_navegador()
    nav = Navegador(versao["webSocketDebuggerUrl"])
    App(nav).iniciar()
    log("Pronto. O painel aparece no WMS (botão no canto inferior direito). Feche o navegador para sair.")
    while nav.vivo:
        time.sleep(1)


if __name__ == "__main__":
    try:
        principal()
    except Exception as e:
        aviso_erro(f"Não foi possível abrir o Painel Qualidade:\n\n{e}")
        sys.exit(1)
