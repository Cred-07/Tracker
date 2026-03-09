import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Plus, Search, X, Trash2, Filter, Calendar, Shield, Server,
  CheckCircle2, FileText, User, Edit3, ArrowUpDown, Bandage,
  Download, Upload, Settings, Cloud, CloudOff, RefreshCw,
  ExternalLink, FolderOpen, Link, Copy, Check, ChevronDown,
  Database, Code, File, AlertCircle
} from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  loadSettings, saveSettings, pushPatches, pullPatches,
  uploadFileToDrive, generateAppsScript, extractFolderIdFromUrl, extractSheetIdFromUrl
} from './googleSheets'

/* ── helpers ───────────────────────────────────── */

const uid = (() => { let c = Date.now(); return () => `p_${c++}` })()
const STORAGE_KEY = 'patch_tracker_data'

const ENV_STYLES = {
  Production: { bg: 'bg-rose-500/20', text: 'text-rose-300', dot: 'bg-rose-400' },
  'Pre-Prod':  { bg: 'bg-amber-500/20', text: 'text-amber-300', dot: 'bg-amber-400' },
  SIT:         { bg: 'bg-emerald-500/20', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  UAT:         { bg: 'bg-violet-500/20', text: 'text-violet-300', dot: 'bg-violet-400' },
  Dev:         { bg: 'bg-sky-500/20', text: 'text-sky-300', dot: 'bg-sky-400' },
}
const TEST_STYLES = {
  Passed:        { bg: 'bg-emerald-500/20', text: 'text-emerald-300' },
  'In Progress': { bg: 'bg-amber-500/20', text: 'text-amber-300' },
  Failed:        { bg: 'bg-rose-500/20', text: 'text-rose-300' },
  Pending:       { bg: 'bg-neutral-500/20', text: 'text-neutral-400' },
}
const DEPLOY_STYLES = {
  Deployed:    { bg: 'bg-emerald-500/20', text: 'text-emerald-300' },
  'In Queue':  { bg: 'bg-amber-500/20', text: 'text-amber-300' },
  Rolled_Back: { bg: 'bg-rose-500/20', text: 'text-rose-300' },
  Scheduled:   { bg: 'bg-sky-500/20', text: 'text-sky-300' },
}

const ENVIRONMENTS = Object.keys(ENV_STYLES)
const TEST_STATUSES = Object.keys(TEST_STYLES)
const DEPLOY_STATUSES = Object.keys(DEPLOY_STYLES)

function formatDateShort(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function todayStr() { return new Date().toISOString().split('T')[0] }

/** Parse a Windows/Unix path → { name, directory, isDbScript } */
function parsePath(fullPath) {
  const p = fullPath.replace(/\\/g, '/')
  const parts = p.split('/').filter(Boolean)
  const name = parts[parts.length - 1] || ''
  const directory = parts.slice(0, -1).join('/')
  const isDbScript = /dbscript/i.test(p)
  return { name, directory, fullPath, isDbScript }
}

/* ── seed data ─────────────────────────────────── */

const SEED = [
  { id: uid(), name: 'Status API patch', preparedDate: '2026-03-23', releaseDate: '2026-03-23',
    environment: 'Production', testingStatus: 'Passed', deploymentStatus: 'Deployed',
    responsiblePerson: 'Adarsh Pandey',
    codeFiles: [{ id: uid(), name: 'RCA_GenBillAmt_Failure_on_RB', oldPath: '', newPath: '', url: '' }],
    dbScripts: [] },
  { id: uid(), name: 'Pre-Prod patch release (KDAC signoff)', preparedDate: '2026-03-02', releaseDate: '2026-03-02',
    environment: 'Pre-Prod', testingStatus: 'In Progress', deploymentStatus: 'Deployed',
    responsiblePerson: 'Adarsh Pandey', codeFiles: [], dbScripts: [] },
  { id: uid(), name: 'KR200 / STP patch release', preparedDate: '2026-02-12', releaseDate: '2026-02-12',
    environment: 'SIT', testingStatus: 'Passed', deploymentStatus: 'Deployed',
    responsiblePerson: 'Adarsh Pandey', codeFiles: [], dbScripts: [] },
  { id: uid(), name: 'RBI optimization patch with STP', preparedDate: '2026-02-11', releaseDate: '2026-02-11',
    environment: 'SIT', testingStatus: 'Passed', deploymentStatus: 'Deployed',
    responsiblePerson: 'Adarsh Pandey', codeFiles: [], dbScripts: [] },
  { id: uid(), name: 'STP point patch #8', preparedDate: '2026-02-10', releaseDate: '2026-02-11',
    environment: 'SIT', testingStatus: 'Passed', deploymentStatus: 'Deployed',
    responsiblePerson: 'Adarsh Pandey',
    codeFiles: [{ id: uid(), name: 'KB100084366101072 / LRS API d...', oldPath: '', newPath: '', url: '' }],
    dbScripts: [] },
]

/* ── small UI pieces ───────────────────────────── */

function Badge({ label, styles }) {
  const s = styles || { bg: 'bg-neutral-500/20', text: 'text-neutral-400' }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg ${s.bg} ${s.text}`}>
      {s.dot && <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${label === 'In Progress' || label === 'In Queue' ? 'dot-pulse' : ''}`} />}
      {label}
    </span>
  )
}

function StatCard({ icon: Icon, label, value, delay }) {
  return (
    <div className="stat-animate neu-raised-sm flex items-center gap-3 px-4 py-3"
         style={{ animationDelay: `${delay}ms` }}>
      <div className="w-9 h-9 rounded-lg bg-neu-bg flex items-center justify-center"
           style={{ boxShadow: 'inset 2px 2px 5px #111213, inset -2px -2px 5px #252629' }}>
        <Icon size={16} className="text-neu-accent" />
      </div>
      <div>
        <div className="text-lg font-bold text-neu-text">{value}</div>
        <div className="text-[10px] uppercase tracking-widest text-neu-muted font-medium">{label}</div>
      </div>
    </div>
  )
}

function NeuInput({ label, value, onChange, type = 'text', placeholder = '', className = '' }) {
  return (
    <div className={className}>
      {label && <label className="block text-[10px] uppercase tracking-widest text-neu-muted font-medium mb-1.5">{label}</label>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
             className="w-full pt-input" />
    </div>
  )
}

function NeuSelect({ label, value, onChange, options, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="block text-[10px] uppercase tracking-widest text-neu-muted font-medium mb-1.5">{label}</label>}
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full pt-select">
        {options.map(o => <option key={o} value={o}>{o || '— All —'}</option>)}
      </select>
    </div>
  )
}

/* ── file entry component ──────────────────────── */

function FileEntry({ file, onRemove, onUpdate, webAppUrl, patchName }) {
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  const handleUpload = async (e) => {
    const f = e.target.files?.[0]
    if (!f || !webAppUrl) return
    setUploading(true)
    try {
      const result = await uploadFileToDrive(webAppUrl, f, patchName)
      onUpdate({ ...file, name: file.name || result.fileName, url: result.fileUrl })
    } catch (err) {
      alert('Upload failed: ' + err.message)
    }
    setUploading(false)
    e.target.value = ''
  }

  return (
    <div className="file-item flex items-start gap-3 group">
      <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-neu-text truncate">{file.name || 'Unnamed file'}</span>
          {file.url && (
            <a href={file.url} target="_blank" rel="noopener noreferrer"
               className="text-neu-accent hover:underline text-[10px] flex items-center gap-0.5 shrink-0">
              <ExternalLink size={9} /> Open
            </a>
          )}
        </div>
        {(file.oldPath || file.newPath) && (
          <div className="text-[10px] text-neu-muted space-y-0.5">
            {file.oldPath && <div><span className="text-rose-400/70">old:</span> {file.oldPath}</div>}
            {file.newPath && <div><span className="text-emerald-400/70">new:</span> {file.newPath}</div>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {webAppUrl && (
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="p-1.5 rounded-lg hover:bg-neu-light transition-colors" title="Upload to Drive">
            {uploading ? <RefreshCw size={12} className="animate-spin text-neu-muted" /> : <Upload size={12} className="text-neu-muted" />}
          </button>
        )}
        <button onClick={onRemove} className="p-1.5 rounded-lg hover:bg-rose-500/15 transition-colors" title="Remove">
          <Trash2 size={12} className="text-rose-400/60" />
        </button>
      </div>
    </div>
  )
}

/* ── file section (code or db scripts) ─────────── */

function FileSection({ label, icon: Icon, files, setFiles, webAppUrl, patchName }) {
  const [pathInput, setPathInput] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [mode, setMode] = useState('path') // 'path' | 'url'

  const addFromPath = () => {
    if (!pathInput.trim()) return
    const parsed = parsePath(pathInput.trim())
    setFiles(prev => [...prev, {
      id: uid(),
      name: parsed.name,
      oldPath: pathInput.trim(),
      newPath: '',
      url: '',
    }])
    setPathInput('')
  }

  const addFromUrl = () => {
    if (!urlInput.trim()) return
    const urlName = urlInput.split('/').pop() || 'Linked file'
    setFiles(prev => [...prev, {
      id: uid(),
      name: urlName,
      oldPath: '',
      newPath: '',
      url: urlInput.trim(),
    }])
    setUrlInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      mode === 'path' ? addFromPath() : addFromUrl()
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={13} className="text-neu-accent" />
        <span className="text-[10px] uppercase tracking-widest text-neu-muted font-medium">{label}</span>
        <span className="text-[10px] text-neu-muted">({files.length})</span>
      </div>

      {/* existing files */}
      {files.length > 0 && (
        <div className="space-y-2 mb-3">
          {files.map(f => (
            <FileEntry key={f.id} file={f} patchName={patchName} webAppUrl={webAppUrl}
                       onRemove={() => setFiles(prev => prev.filter(x => x.id !== f.id))}
                       onUpdate={updated => setFiles(prev => prev.map(x => x.id === f.id ? updated : x))} />
          ))}
        </div>
      )}

      {/* add new */}
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-lg overflow-hidden" style={{ boxShadow: 'inset 2px 2px 5px #111213, inset -2px -2px 5px #252629' }}>
          <button onClick={() => setMode('path')}
                  className={`px-3 py-1.5 text-[10px] font-medium transition-colors ${mode === 'path' ? 'bg-neu-accent/20 text-neu-accent' : 'bg-neu-bg text-neu-muted'}`}>
            Path
          </button>
          <button onClick={() => setMode('url')}
                  className={`px-3 py-1.5 text-[10px] font-medium transition-colors ${mode === 'url' ? 'bg-neu-accent/20 text-neu-accent' : 'bg-neu-bg text-neu-muted'}`}>
            URL
          </button>
        </div>
        <div className="flex-1 flex gap-2">
          {mode === 'path' ? (
            <input value={pathInput} onChange={e => setPathInput(e.target.value)} onKeyDown={handleKeyDown}
                   placeholder="C:\path\to\file or paste path..."
                   className="flex-1 pt-input text-xs !py-2 !rounded-lg" />
          ) : (
            <input value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={handleKeyDown}
                   placeholder="https://drive.google.com/..."
                   className="flex-1 pt-input text-xs !py-2 !rounded-lg" />
          )}
          <button onClick={mode === 'path' ? addFromPath : addFromUrl}
                  className="px-3 py-1.5 rounded-lg bg-neu-surface text-neu-accent text-xs font-medium"
                  style={{ boxShadow: '2px 2px 6px #111213, -2px -2px 6px #2e3035' }}>
            <Plus size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── patch create/edit modal ───────────────────── */

function PatchModal({ patch, onSave, onClose }) {
  const isEdit = !!patch
  const settings = loadSettings()
  const [form, setForm] = useState(patch || {
    name: '', preparedDate: todayStr(), releaseDate: todayStr(),
    environment: 'SIT', testingStatus: 'Pending', deploymentStatus: 'In Queue',
    responsiblePerson: '', codeFiles: [], dbScripts: [],
  })

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const handlePathPaste = (text) => {
    // Auto-detect if path is DBScript or code
    const parsed = parsePath(text)
    if (parsed.isDbScript) {
      set('dbScripts', [...form.dbScripts, { id: uid(), name: parsed.name, oldPath: text, newPath: '', url: '' }])
    } else {
      set('codeFiles', [...form.codeFiles, { id: uid(), name: parsed.name, oldPath: text, newPath: '', url: '' }])
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    onSave({ ...form, id: form.id || uid() })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-animate"
         onClick={onClose}
         style={{ backgroundColor: 'rgba(10, 10, 14, 0.8)', backdropFilter: 'blur(10px)' }}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()}
            className="modal-animate w-full max-w-2xl neu-raised p-6 max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-neu-accent">{isEdit ? 'Edit Patch' : 'New Patch'}</h2>
          <button type="button" onClick={onClose}
                  className="p-2 rounded-lg hover:bg-neu-light transition-colors">
            <X size={16} className="text-neu-muted" />
          </button>
        </div>

        <div className="space-y-5">
          <NeuInput label="Patch Name" value={form.name} onChange={v => set('name', v)} placeholder="e.g. Status API patch" />

          <div className="grid grid-cols-2 gap-4">
            <NeuInput label="Prepared Date" type="date" value={form.preparedDate} onChange={v => set('preparedDate', v)} />
            <NeuInput label="Release Date" type="date" value={form.releaseDate} onChange={v => set('releaseDate', v)} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <NeuSelect label="Environment" value={form.environment} onChange={v => set('environment', v)} options={ENVIRONMENTS} />
            <NeuSelect label="Testing" value={form.testingStatus} onChange={v => set('testingStatus', v)} options={TEST_STATUSES} />
            <NeuSelect label="Deployment" value={form.deploymentStatus} onChange={v => set('deploymentStatus', v)} options={DEPLOY_STATUSES} />
          </div>

          <NeuInput label="Responsible Person" value={form.responsiblePerson} onChange={v => set('responsiblePerson', v)} placeholder="e.g. Adarsh Pandey" />

          {/* ── divider ── */}
          <div className="border-t border-neu-light pt-4">
            <FileSection label="Code Files" icon={Code} files={form.codeFiles}
                         setFiles={v => set('codeFiles', typeof v === 'function' ? v(form.codeFiles) : v)}
                         webAppUrl={settings.webAppUrl} patchName={form.name} />
          </div>

          <div className="border-t border-neu-light pt-4">
            <FileSection label="DB Scripts" icon={Database} files={form.dbScripts}
                         setFiles={v => set('dbScripts', typeof v === 'function' ? v(form.dbScripts) : v)}
                         webAppUrl={settings.webAppUrl} patchName={form.name} />
          </div>

          {/* ── auto-detect drop zone ── */}
          <div className="border-t border-neu-light pt-4">
            <div className="text-[10px] uppercase tracking-widest text-neu-muted font-medium mb-2">Quick Add — Paste a path</div>
            <input placeholder="Paste any path — auto-detects code vs DB script..."
                   className="w-full pt-input text-xs"
                   onKeyDown={e => {
                     if (e.key === 'Enter' && e.target.value.trim()) {
                       handlePathPaste(e.target.value.trim())
                       e.target.value = ''
                     }
                   }} />
            <p className="text-[9px] text-neu-muted mt-1">Paths containing "DBScript" auto-sort to DB Scripts, others go to Code Files</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button type="button" onClick={onClose} className="pt-btn-outline">Cancel</button>
          <button type="submit" className="pt-btn">{isEdit ? 'Save Changes' : 'Create Patch'}</button>
        </div>
      </form>
    </div>
  )
}

/* ── view toggle ───────────────────────────────── */

function ViewToggle({ view, setView }) {
  return (
    <div className="inline-flex neu-pressed-sm p-1 gap-1">
      {['All Patches', 'Recent'].map(v => (
        <button key={v} onClick={() => setView(v)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                  view === v
                    ? 'bg-neu-accent text-neu-dark shadow-md'
                    : 'text-neu-muted hover:text-neu-text'
                }`}>
          {v}
        </button>
      ))}
    </div>
  )
}

/* ── sort button ───────────────────────────────── */

function SortBtn({ column, sortBy, sortDir, onSort }) {
  const active = sortBy === column
  return (
    <button onClick={() => onSort(column)}
            className={`transition-colors ${active ? 'text-neu-accent' : 'text-neu-muted hover:text-neu-text'}`}>
      <ArrowUpDown size={11} />
    </button>
  )
}

/* ── filter dropdown ───────────────────────────── */

function FilterDropdown({ filters, setFilters }) {
  const [open, setOpen] = useState(false)
  const active = filters.environment || filters.testingStatus || filters.deploymentStatus

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                active ? 'neu-raised-sm text-neu-accent' : 'neu-raised-sm text-neu-muted'
              }`}>
        <Filter size={13} />
        Filters
        {active && <span className="w-1.5 h-1.5 rounded-full bg-neu-accent" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-64 neu-raised p-4 modal-animate">
            <div className="space-y-3">
              <NeuSelect label="Environment" value={filters.environment}
                         onChange={v => setFilters(p => ({ ...p, environment: v }))}
                         options={['', ...ENVIRONMENTS]} />
              <NeuSelect label="Testing Status" value={filters.testingStatus}
                         onChange={v => setFilters(p => ({ ...p, testingStatus: v }))}
                         options={['', ...TEST_STATUSES]} />
              <NeuSelect label="Deployment Status" value={filters.deploymentStatus}
                         onChange={v => setFilters(p => ({ ...p, deploymentStatus: v }))}
                         options={['', ...DEPLOY_STATUSES]} />
              <button onClick={() => { setFilters({ environment: '', testingStatus: '', deploymentStatus: '' }); setOpen(false) }}
                      className="w-full text-[10px] text-neu-muted hover:text-neu-accent transition-colors pt-1">
                Clear all filters
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ── setup / settings modal ────────────────────── */

function SetupGuide({ copied, onCopy }) {
  const [folderUrl, setFolderUrl] = useState('')
  const [scriptGenerated, setScriptGenerated] = useState(false)

  const folderId = folderUrl ? extractFolderIdFromUrl(folderUrl) : ''
  const generatedScript = generateAppsScript(folderId)

  const handleCopyGenerated = () => {
    navigator.clipboard.writeText(generatedScript)
    setScriptGenerated(true)
    setTimeout(() => setScriptGenerated(false), 2000)
  }

  return (
    <div className="space-y-4">
      {/* Step 1: Paste URLs */}
      <div className="neu-pressed p-4 space-y-3">
        <p className="font-semibold text-neu-accent text-xs">Step 1 — Paste your Google Drive folder URL</p>
        <input value={folderUrl} onChange={e => setFolderUrl(e.target.value)}
               placeholder="https://drive.google.com/drive/folders/..."
               className="w-full pt-input text-xs font-mono" />
        {folderId && (
          <div className="flex items-center gap-2 text-[10px]">
            <Check size={11} className="text-emerald-400" />
            <span className="text-emerald-300">Folder ID extracted: <code className="text-neu-accent bg-neu-dark px-1 py-0.5 rounded">{folderId.slice(0, 20)}...</code></span>
          </div>
        )}
      </div>

      {/* Step 2: Copy generated script */}
      <div className="neu-pressed p-4 space-y-3">
        <p className="font-semibold text-neu-accent text-xs">Step 2 — Copy the auto-generated script</p>
        <p className="text-[10px] text-neu-muted">
          {folderId
            ? 'Script is ready with your folder ID pre-filled. Copy it below.'
            : 'Paste your folder URL above first to generate the script with your folder ID.'}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-neu-muted font-medium">Apps Script Code</span>
          <button onClick={handleCopyGenerated} disabled={!folderId}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all disabled:opacity-30"
                  style={{ boxShadow: '2px 2px 6px #111213, -2px -2px 6px #2e3035' }}>
            {scriptGenerated ? <><Check size={11} className="text-emerald-400" /> Copied!</>
                             : <><Copy size={11} className="text-neu-muted" /> Copy Script</>}
          </button>
        </div>
        <pre className="neu-pressed p-3 text-[9px] text-neu-muted font-mono overflow-x-auto max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed">
          {generatedScript}
        </pre>
      </div>

      {/* Step 3: Deploy instructions */}
      <div className="neu-pressed p-4 space-y-3 text-xs">
        <p className="font-semibold text-neu-accent">Step 3 — Deploy in Google Sheets</p>
        <ol className="list-decimal list-inside space-y-1.5 text-neu-muted text-[11px]">
          <li>Open your Google Spreadsheet</li>
          <li>Go to <strong className="text-neu-text">Extensions → Apps Script</strong></li>
          <li>Delete any existing code, <strong className="text-neu-text">paste the copied script</strong></li>
          <li>Click <strong className="text-neu-text">Deploy → New deployment</strong></li>
          <li>Type: <strong className="text-neu-text">Web app</strong> — Execute as: <strong className="text-neu-text">Me</strong> — Access: <strong className="text-neu-text">Anyone</strong></li>
          <li>Click Deploy, authorize when prompted</li>
          <li><strong className="text-neu-text">Copy the Web App URL</strong> → go to Connect tab → paste it</li>
        </ol>
      </div>

      <div className="neu-pressed-sm p-3 flex items-start gap-2">
        <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[10px] text-neu-muted">
          <strong className="text-amber-300">No Google Cloud Console needed.</strong> The script only accesses the current spreadsheet and creates files in your specified folder. No delete access. You share the Sheet & folder with your team manually.
        </p>
      </div>
    </div>
  )
}

function SetupModal({ onClose, patches, setPatches }) {
  const [settings, setSettings_] = useState(loadSettings())
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState('')
  const [tab, setTab] = useState('connect') // 'connect' | 'setup'

  const set = (k, v) => setSettings_(prev => ({ ...prev, [k]: v }))

  const handleSaveSettings = () => {
    saveSettings(settings)
    setStatus('Settings saved!')
    setTimeout(() => setStatus(''), 2000)
  }

  const handlePush = async () => {
    if (!settings.webAppUrl) { setStatus('Enter Web App URL first'); return }
    setLoading('push')
    try {
      await pushPatches(settings.webAppUrl, patches)
      setStatus(`Pushed ${patches.length} patches to Google Sheets!`)
    } catch (err) { setStatus(`Push failed: ${err.message}`) }
    setLoading('')
  }

  const handlePull = async () => {
    if (!settings.webAppUrl) { setStatus('Enter Web App URL first'); return }
    setLoading('pull')
    try {
      const pulled = await pullPatches(settings.webAppUrl)
      setPatches(pulled)
      setStatus(`Pulled ${pulled.length} patches from Google Sheets!`)
    } catch (err) { setStatus(`Pull failed: ${err.message}`) }
    setLoading('')
  }



  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-animate"
         onClick={onClose}
         style={{ backgroundColor: 'rgba(10, 10, 14, 0.8)', backdropFilter: 'blur(10px)' }}>
      <div onClick={e => e.stopPropagation()}
           className="modal-animate w-full max-w-lg neu-raised p-6 max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-neu-accent flex items-center gap-2">
            <Cloud size={18} /> Google Sheets & Drive
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-neu-light transition-colors">
            <X size={16} className="text-neu-muted" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {[['connect', 'Connect'], ['setup', 'Setup Guide']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
                    className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                      tab === k ? 'bg-neu-accent/15 text-neu-accent' : 'text-neu-muted hover:text-neu-text'
                    }`}
                    style={tab === k ? {} : { boxShadow: 'inset 2px 2px 5px #111213, inset -2px -2px 5px #252629' }}>
              {l}
            </button>
          ))}
        </div>

        {tab === 'connect' && (
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-neu-muted font-medium mb-1.5">
                Web App URL
              </label>
              <input value={settings.webAppUrl || ''} onChange={e => set('webAppUrl', e.target.value)}
                     placeholder="https://script.google.com/macros/s/.../exec"
                     className="w-full pt-input text-xs font-mono" />
              <p className="text-[9px] text-neu-muted mt-1">
                Get this from Apps Script → Deploy → Web app → URL
              </p>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <div className={`relative w-9 h-5 rounded-full transition-colors ${settings.autoSync ? 'bg-neu-accent' : 'bg-neu-dark'}`}
                   style={{ boxShadow: 'inset 2px 2px 4px #111213, inset -2px -2px 4px #252629' }}
                   onClick={() => set('autoSync', !settings.autoSync)}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-transform ${settings.autoSync ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-xs text-neu-text">Auto-sync on every change</span>
            </label>

            <button onClick={handleSaveSettings} className="w-full pt-btn-outline">Save Settings</button>

            {settings.webAppUrl && (
              <div className="flex gap-2 pt-2">
                <button onClick={handlePush} disabled={!!loading}
                        className="flex-1 pt-btn-outline flex items-center justify-center gap-2 !text-neu-accent">
                  {loading === 'push' ? <RefreshCw size={13} className="animate-spin" /> : <Upload size={13} />}
                  Push to Sheets
                </button>
                <button onClick={handlePull} disabled={!!loading}
                        className="flex-1 pt-btn-outline flex items-center justify-center gap-2">
                  {loading === 'pull' ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
                  Pull from Sheets
                </button>
              </div>
            )}

            {status && (
              <div className={`px-3 py-2 rounded-lg text-xs font-medium ${
                status.includes('fail') || status.includes('Error') || status.includes('Enter')
                  ? 'bg-rose-500/15 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'
              }`}>{status}</div>
            )}
          </div>
        )}

        {tab === 'setup' && (
          <SetupGuide />
        )}
      </div>
    </div>
  )
}

/* ── data menu ─────────────────────────────────── */

function DataMenu({ patches, setPatches, onOpenSetup }) {
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState('')
  const fileRef = useRef(null)
  const settings = loadSettings()

  const handleExport = () => {
    const COLS = [
      { key: 'name', h: 'Patch Name' }, { key: 'preparedDate', h: 'Prepared Date' },
      { key: 'releaseDate', h: 'Release Date' }, { key: 'environment', h: 'Environment' },
      { key: 'testingStatus', h: 'Testing Status' }, { key: 'deploymentStatus', h: 'Deployment Status' },
      { key: 'responsiblePerson', h: 'Responsible Person' },
      { key: 'codeFiles', h: 'Code Files' }, { key: 'dbScripts', h: 'DB Scripts' },
    ]
    const rows = patches.map(p => Object.fromEntries(COLS.map(c => {
      let val = p[c.key]
      if (Array.isArray(val)) val = val.map(f => f.name + (f.url ? ` (${f.url})` : '')).join('; ')
      return [c.h, val || '']
    })))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = COLS.map(c => ({ wch: Math.max(c.h.length, 22) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Patches')
    XLSX.writeFile(wb, `PatchTracker_${new Date().toISOString().slice(0, 10)}.xlsx`)
    setOpen(false)
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
      const imported = rows.map(row => ({
        id: uid(), name: row['Patch Name'] || 'Unnamed',
        preparedDate: row['Prepared Date'] || todayStr(),
        releaseDate: row['Release Date'] || todayStr(),
        environment: row['Environment'] || 'SIT',
        testingStatus: row['Testing Status'] || 'Pending',
        deploymentStatus: row['Deployment Status'] || 'In Queue',
        responsiblePerson: row['Responsible Person'] || '',
        codeFiles: [], dbScripts: [],
      }))
      setPatches(prev => [...imported, ...prev])
      setToast(`Imported ${imported.length} patches`)
    } catch { setToast('Import failed') }
    e.target.value = ''
    setOpen(false)
    setTimeout(() => setToast(''), 3000)
  }

  return (
    <div className="relative">
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
      <button onClick={() => setOpen(!open)} className="neu-raised-sm flex items-center gap-2 px-3 py-2 text-xs font-medium text-neu-muted">
        <Settings size={13} /> Data
        {settings.webAppUrl && settings.autoSync && <span className="w-1.5 h-1.5 rounded-full bg-neu-accent dot-pulse" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-56 neu-raised overflow-hidden modal-animate">
            <div className="px-3 py-2 border-b border-neu-light">
              <span className="text-[9px] uppercase tracking-widest text-neu-muted font-medium">Excel</span>
            </div>
            <button onClick={handleExport}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-neu-text hover:bg-neu-light transition-colors">
              <Download size={14} className="text-neu-accent" /> Export to Excel
            </button>
            <button onClick={() => fileRef.current?.click()}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-neu-text hover:bg-neu-light transition-colors">
              <Upload size={14} className="text-neu-accent" /> Import from Excel
            </button>
            <div className="px-3 py-2 border-t border-b border-neu-light">
              <span className="text-[9px] uppercase tracking-widest text-neu-muted font-medium">Google Sheets & Drive</span>
            </div>
            <button onClick={() => { onOpenSetup(); setOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-neu-text hover:bg-neu-light transition-colors">
              <Cloud size={14} className="text-neu-accent" />
              {settings.webAppUrl ? 'Sync Settings' : 'Connect Google Sheets'}
              {settings.webAppUrl && <span className="ml-auto text-[9px] text-emerald-400">Active</span>}
            </button>
          </div>
        </>
      )}
      {toast && (
        <div className={`absolute right-0 top-full mt-2 z-50 px-3 py-2 rounded-lg text-xs whitespace-nowrap ${
          toast.includes('fail') ? 'bg-rose-500/15 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'
        }`}>{toast}</div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════ */

export default function PatchTracker() {
  const [patches, setPatches] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : SEED
    } catch { return SEED }
  })

  const [search, setSearch] = useState('')
  const [view, setView] = useState('All Patches')
  const [showModal, setShowModal] = useState(false)
  const [editPatch, setEditPatch] = useState(null)
  const [sortBy, setSortBy] = useState('releaseDate')
  const [sortDir, setSortDir] = useState('desc')
  const [filters, setFilters] = useState({ environment: '', testingStatus: '', deploymentStatus: '' })
  const [showSetup, setShowSetup] = useState(false)

  // Persist + auto-sync
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patches))
    const s = loadSettings()
    if (s.autoSync && s.webAppUrl) {
      pushPatches(s.webAppUrl, patches).catch(() => {})
    }
  }, [patches])

  const handleSort = useCallback((col) => {
    setSortBy(prev => {
      if (prev === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return col }
      setSortDir('desc')
      return col
    })
  }, [])

  const handleSave = useCallback((patch) => {
    setPatches(prev => {
      const idx = prev.findIndex(p => p.id === patch.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = patch; return next }
      return [patch, ...prev]
    })
    setShowModal(false)
    setEditPatch(null)
  }, [])

  const handleDelete = useCallback(id => setPatches(prev => prev.filter(p => p.id !== id)), [])
  const handleEdit = useCallback(patch => { setEditPatch(patch); setShowModal(true) }, [])

  const filteredPatches = useMemo(() => {
    let list = patches
    if (view === 'Recent') {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30)
      list = list.filter(p => new Date(p.releaseDate) >= cutoff)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.responsiblePerson.toLowerCase().includes(q) ||
        p.environment.toLowerCase().includes(q) ||
        (p.codeFiles || []).some(f => f.name.toLowerCase().includes(q)) ||
        (p.dbScripts || []).some(f => f.name.toLowerCase().includes(q))
      )
    }
    if (filters.environment) list = list.filter(p => p.environment === filters.environment)
    if (filters.testingStatus) list = list.filter(p => p.testingStatus === filters.testingStatus)
    if (filters.deploymentStatus) list = list.filter(p => p.deploymentStatus === filters.deploymentStatus)
    return [...list].sort((a, b) => {
      let av = a[sortBy], bv = b[sortBy]
      if (sortBy.includes('Date')) { av = new Date(av); bv = new Date(bv) }
      else { av = (av || '').toLowerCase(); bv = (bv || '').toLowerCase() }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [patches, search, view, filters, sortBy, sortDir])

  const stats = useMemo(() => ({
    total: patches.length,
    deployed: patches.filter(p => p.deploymentStatus === 'Deployed').length,
    passed: patches.filter(p => p.testingStatus === 'Passed').length,
    production: patches.filter(p => p.environment === 'Production').length,
  }), [patches])

  const TABLE_COLS = [
    { key: 'name', label: 'Patch Name', icon: FileText },
    { key: 'preparedDate', label: 'Prepared', icon: Calendar },
    { key: 'releaseDate', label: 'Released', icon: Calendar },
    { key: 'environment', label: 'Environment', icon: Server },
    { key: 'testingStatus', label: 'Testing', icon: Shield },
    { key: 'deploymentStatus', label: 'Deployment', icon: CheckCircle2 },
    { key: 'responsiblePerson', label: 'Responsible', icon: User },
    { key: 'filesChanged', label: 'Files', icon: FolderOpen },
  ]

  return (
    <div className="min-h-screen px-4 py-8 md:px-8 lg:px-12 max-w-[1440px] mx-auto">

      {/* ── header ── */}
      <header className="header-animate mb-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-neu-surface flex items-center justify-center"
                   style={{ boxShadow: '3px 3px 8px #111213, -3px -3px 8px #2e3035' }}>
                <Bandage size={20} className="text-neu-accent" />
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-neu-text tracking-tight">
                Patch <span className="text-neu-accent">Tracker</span>
              </h1>
            </div>
            <p className="text-xs text-neu-muted mt-1 ml-1">Track deployment patches across environments</p>
          </div>
          <div className="flex items-center gap-3 self-start md:self-auto">
            <DataMenu patches={patches} setPatches={setPatches} onOpenSetup={() => setShowSetup(true)} />
            <button onClick={() => { setEditPatch(null); setShowModal(true) }} className="pt-btn flex items-center gap-2">
              <Plus size={16} strokeWidth={2.5} /> New Patch
            </button>
          </div>
        </div>

        {/* ── stats ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard icon={FileText} label="Total" value={stats.total} delay={100} />
          <StatCard icon={CheckCircle2} label="Deployed" value={stats.deployed} delay={200} />
          <StatCard icon={Shield} label="Passed" value={stats.passed} delay={300} />
          <StatCard icon={Server} label="Production" value={stats.production} delay={400} />
        </div>

        {/* ── toolbar ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <ViewToggle view={view} setView={setView} />
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            <FilterDropdown filters={filters} setFilters={setFilters} />
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neu-muted" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patches..."
                     className="pt-input pl-9 pr-8 !py-2 text-xs w-56" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neu-muted hover:text-neu-text">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── table ── */}
      <div className="pt-table-wrapper neu-raised overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-neu-light">
              {TABLE_COLS.map(col => (
                <th key={col.key} className="px-4 py-3 text-[10px] uppercase tracking-widest text-neu-muted font-medium whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <col.icon size={11} className="text-neu-muted opacity-50" />
                    {col.label}
                    <SortBtn column={col.key} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  </div>
                </th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {filteredPatches.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-16 text-center text-sm text-neu-muted">
                  {search || filters.environment || filters.testingStatus || filters.deploymentStatus
                    ? 'No patches match your filters' : 'No patches yet. Create your first patch!'}
                </td>
              </tr>
            ) : filteredPatches.map((patch, i) => {
              const filesCount = (patch.codeFiles?.length || 0) + (patch.dbScripts?.length || 0)
              const filesLabel = (patch.codeFiles || []).map(f => f.name).concat((patch.dbScripts || []).map(f => f.name)).join(', ')
              return (
                <tr key={patch.id} className="row-animate table-row-hover border-b border-neu-dark/50 last:border-b-0"
                    style={{ animationDelay: `${i * 40}ms` }}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText size={13} className="text-neu-muted shrink-0" />
                      <span className="text-sm font-medium text-neu-text truncate max-w-[220px]">{patch.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-neu-muted font-mono">{formatDateShort(patch.preparedDate)}</td>
                  <td className="px-4 py-3 text-xs text-neu-muted font-mono">{formatDateShort(patch.releaseDate)}</td>
                  <td className="px-4 py-3"><Badge label={patch.environment} styles={ENV_STYLES[patch.environment]} /></td>
                  <td className="px-4 py-3"><Badge label={patch.testingStatus} styles={TEST_STYLES[patch.testingStatus]} /></td>
                  <td className="px-4 py-3"><Badge label={patch.deploymentStatus} styles={DEPLOY_STYLES[patch.deploymentStatus]} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-neu-bg flex items-center justify-center text-[10px] font-bold text-neu-accent"
                           style={{ boxShadow: 'inset 1px 1px 3px #111213, inset -1px -1px 3px #252629' }}>
                        {patch.responsiblePerson ? patch.responsiblePerson.split(' ').map(n => n[0]).join('') : '?'}
                      </div>
                      <span className="text-xs text-neu-text">{patch.responsiblePerson || '—'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {filesCount > 0 ? (
                      <span className="text-xs text-neu-muted truncate block max-w-[180px]" title={filesLabel}>
                        <span className="text-neu-accent font-medium">{filesCount}</span> {filesCount === 1 ? 'file' : 'files'}
                      </span>
                    ) : <span className="text-xs text-neu-muted">—</span>}
                  </td>
                  <td className="px-2 py-3">
                    <div className="action-reveal flex items-center gap-1">
                      <button onClick={() => handleEdit(patch)}
                              className="p-1.5 rounded-lg hover:bg-neu-light transition-colors" title="Edit">
                        <Edit3 size={12} className="text-neu-muted" />
                      </button>
                      <button onClick={() => handleDelete(patch.id)}
                              className="p-1.5 rounded-lg hover:bg-rose-500/15 transition-colors" title="Delete">
                        <Trash2 size={12} className="text-rose-400/60" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── footer ── */}
      <div className="mt-4 flex items-center justify-between px-1">
        <span className="text-[10px] text-neu-muted font-mono">{filteredPatches.length} of {patches.length} patches</span>
        <span className="text-[10px] text-neu-muted">
          {loadSettings().webAppUrl ? 'Synced to Google Sheets' : 'localStorage only'}
        </span>
      </div>

      {/* ── modals ── */}
      {showModal && <PatchModal patch={editPatch} onSave={handleSave} onClose={() => { setShowModal(false); setEditPatch(null) }} />}
      {showSetup && <SetupModal onClose={() => setShowSetup(false)} patches={patches} setPatches={setPatches} />}
    </div>
  )
}
