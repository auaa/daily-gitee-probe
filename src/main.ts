/**
 * 最小 Gitee Contents API 探测页
 * Token 只留在内存，不写 localStorage / 不提交仓库
 */

import './style.css'

const LS_META = 'gitee-probe.meta'

type Meta = {
  owner: string
  repo: string
  branch: string
  path: string
}

function loadMeta(): Meta {
  try {
    const raw = localStorage.getItem(LS_META)
    if (raw) return { ...defaults(), ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return defaults()
}

function defaults(): Meta {
  return {
    owner: '',
    repo: '',
    branch: 'master',
    path: 'probe/hello.md',
  }
}

function saveMeta(m: Meta) {
  localStorage.setItem(LS_META, JSON.stringify(m))
}

function encodeBase64(text: string) {
  return btoa(unescape(encodeURIComponent(text)))
}

function decodeBase64(b64: string) {
  return decodeURIComponent(escape(atob(b64)))
}

async function giteeFetch(
  token: string,
  owner: string,
  repo: string,
  path: string,
  init?: RequestInit & { query?: Record<string, string> },
) {
  const q = new URLSearchParams({ access_token: token, ...(init?.query || {}) })
  // query 里若重复传 access_token，以后者为准
  if (!q.get('access_token')) q.set('access_token', token)
  const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}?${q}`
  const { query: _q, ...rest } = init || {}
  const res = await fetch(url, rest)
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { res, json, text }
}

function el(html: string) {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild as HTMLElement
}

const app = document.querySelector<HTMLDivElement>('#app')!
const meta = loadMeta()

app.appendChild(
  el(`
  <main class="wrap">
    <h1>Gitee Contents 探测</h1>
    <p class="hint">验证浏览器能否直连 Gitee API 读写 md。Token 仅内存使用，刷新即丢。当前 origin 见日志底部。</p>

    <label>私人令牌 <input id="token" type="password" autocomplete="off" placeholder="gitee private token" /></label>
    <div class="row">
      <label>owner <input id="owner" value="${escapeAttr(meta.owner)}" placeholder="你的用户名" /></label>
      <label>repo <input id="repo" value="${escapeAttr(meta.repo)}" placeholder="仓库名" /></label>
    </div>
    <div class="row">
      <label>branch <input id="branch" value="${escapeAttr(meta.branch)}" /></label>
      <label>path <input id="path" value="${escapeAttr(meta.path)}" /></label>
    </div>

    <label>内容<textarea id="content" rows="8"># hello from probe\n\n时间戳会在写入时更新。</textarea></label>

    <div class="actions">
      <button type="button" id="btn-read">读取</button>
      <button type="button" id="btn-write">写入</button>
      <button type="button" id="btn-ping" class="ghost">测连通性</button>
    </div>

    <pre id="log" class="log">等待操作…</pre>
  </main>
`),
)

function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const input = (id: string) => $(id) as HTMLInputElement | HTMLTextAreaElement
const logEl = $('log')

function log(title: string, data?: unknown) {
  const time = new Date().toLocaleTimeString()
  const body = data === undefined ? '' : '\n' + (typeof data === 'string' ? data : JSON.stringify(data, null, 2))
  logEl.textContent = `[${time}] ${title}${body}\norigin: ${location.origin}`
}

function readForm() {
  const token = input('token').value.trim()
  const owner = input('owner').value.trim()
  const repo = input('repo').value.trim()
  const branch = input('branch').value.trim() || 'master'
  const path = input('path').value.trim().replace(/^\/+/, '')
  saveMeta({ owner, repo, branch, path })
  return { token, owner, repo, branch, path }
}

$('btn-ping').onclick = async () => {
  const { token, owner, repo } = readForm()
  if (!token || !owner || !repo) {
    log('请先填写 token / owner / repo')
    return
  }
  try {
    // 用真实 GET 测浏览器能否跨域读 Gitee（比裸 OPTIONS 更靠谱）
    const q = new URLSearchParams({ access_token: token })
    const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?${q}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    const text = await res.text()
    let json: unknown = text
    try {
      json = JSON.parse(text)
    } catch {
      /* keep text */
    }
    if (!res.ok) {
      log(`连通性失败 HTTP ${res.status}（能收到响应说明 CORS 多半已通，重点看鉴权/仓库名）`, json)
      return
    }
    const info = json as { full_name?: string; default_branch?: string; human_name?: string }
    log('连通性成功：浏览器可直连 Gitee API', {
      full_name: info.full_name,
      default_branch: info.default_branch,
      human_name: info.human_name,
    })
  } catch (e) {
    log('连通性异常：若是 Failed to fetch，才更像 CORS/网络阻断', String(e))
  }
}

$('btn-read').onclick = async () => {
  const { token, owner, repo, branch, path } = readForm()
  if (!token || !owner || !repo || !path) {
    log('请填写 token / owner / repo / path')
    return
  }
  try {
    const { res, json } = await giteeFetch(token, owner, repo, path, {
      method: 'GET',
      query: { ref: branch },
    })
    if (!res.ok) {
      log(`读取失败 HTTP ${res.status}`, json)
      return
    }
    const file = json as { content?: string; sha?: string; encoding?: string; path?: string }
    const text = file.content ? decodeBase64(file.content.replace(/\n/g, '')) : ''
    input('content').value = text
    log(`读取成功 sha=${file.sha || '?'}`, { path: file.path, bytes: text.length })
  } catch (e) {
    log('读取异常', String(e))
  }
}

$('btn-write').onclick = async () => {
  const { token, owner, repo, branch, path } = readForm()
  if (!token || !owner || !repo || !path) {
    log('请填写 token / owner / repo / path')
    return
  }
  const content = input('content').value + `\n\n<!-- probe ${new Date().toISOString()} -->\n`
  input('content').value = content

  try {
    // 先读 sha（更新需要）；不存在则创建
    let sha: string | undefined
    const got = await giteeFetch(token, owner, repo, path, {
      method: 'GET',
      query: { ref: branch },
    })
    if (got.res.ok) {
      sha = (got.json as { sha?: string }).sha
    }

    const body: Record<string, string> = {
      content: encodeBase64(content),
      message: `probe: update ${path}`,
      branch,
    }
    if (sha) body.sha = sha

    const method = sha ? 'PUT' : 'POST'
    const { res, json } = await giteeFetch(token, owner, repo, path, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      query: { access_token: token },
    })
    if (!res.ok) {
      log(`写入失败 HTTP ${res.status} (${method})`, json)
      return
    }
    log(`写入成功 (${method})`, json)
  } catch (e) {
    log('写入异常', String(e))
  }
}
