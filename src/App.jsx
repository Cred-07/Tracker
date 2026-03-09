import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  Search, Plus, Check, Trash2, X, History, LayoutDashboard,
  ChevronDown, ChevronUp, GripVertical, Bandage,
  ClipboardList, CheckCircle2, Clock, Archive,
  Settings, Cloud, CloudOff, RefreshCw, Copy, ExternalLink, Link,
} from 'lucide-react'
import {
  loadTaskSettings, saveTaskSettings, pushTasks, pullTasks,
  generateTasksAppsScript, extractSheetIdFromUrl, generateApiKey,
} from './googleSheets'

// ─── LocalStorage helpers ────────────────────────────────────────
const STORAGE_KEY = 'neutask_data'

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

// ─── Default seed data ───────────────────────────────────────────
const seedTasks = [
  {
    id: '1',
    title: 'Project Launch',
    subtasks: [
      { id: 's1', text: 'Finalize presentation', date: 'Today', done: false },
      { id: 's2', text: 'Record demo video', date: 'Oct 28', done: false },
      { id: 's3', text: 'Review analytics', date: 'Oct 28', done: false },
      { id: 's4', text: 'Send announcement email', date: 'Oct 28', done: false },
    ],
  },
  {
    id: '2',
    title: 'Website Redesign',
    subtasks: [
      { id: 's5', text: 'User flows & sketches', date: 'Today', done: false },
      { id: 's6', text: 'Design mockups', date: 'Oct 28', done: false },
      { id: 's7', text: 'Development Sprint 1', date: 'Oct 17', done: false },
    ],
  },
  {
    id: '3',
    title: 'Marketing Campaign',
    subtasks: [
      { id: 's8', text: 'Content planning', date: 'Oct 28', done: false },
      { id: 's9', text: 'Social Media Ad set', date: 'Oct 28', done: false },
    ],
  },
]

function getInitialState() {
  const saved = loadData()
  if (saved && saved.tasks && saved.history) return saved
  return { tasks: seedTasks, history: [] }
}

// ─── ID generator ────────────────────────────────────────────────
let _id = Date.now()
const uid = () => `id_${++_id}`

const formatNow = () =>
  new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

const formatDate = () =>
  new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// ─── Reorder helper ──────────────────────────────────────────────
function reorder(list, fromIndex, toIndex) {
  const result = [...list]
  const [moved] = result.splice(fromIndex, 1)
  result.splice(toIndex, 0, moved)
  return result
}

// ─── Checkbox ────────────────────────────────────────────────────
function NeuCheckbox({ checked, onChange }) {
  return (
    <button
      onClick={onChange}
      className={`neu-checkbox ${checked ? 'checked' : ''}`}
      aria-label={checked ? 'Mark incomplete' : 'Mark complete'}
    >
      {checked && <Check size={14} strokeWidth={3} className="text-white" />}
    </button>
  )
}

// ─── Draggable Subtask ───────────────────────────────────────────
function Subtask({ subtask, index, onToggle, onDelete, onDragStart, onDragOver, onDrop }) {
  const isTodayDate = subtask.date === 'Today'

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      className="neu-subtask flex items-center gap-2 px-3 py-3 group cursor-grab active:cursor-grabbing"
    >
      <span className="text-neu-muted/40 group-hover:text-neu-muted transition-colors drag-handle">
        <GripVertical size={14} />
      </span>
      <NeuCheckbox checked={subtask.done} onChange={onToggle} />
      <span className={`flex-1 text-sm ${subtask.done ? 'line-through text-neu-muted' : 'text-neu-text'}`}>
        {subtask.text}
      </span>
      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
        isTodayDate ? 'bg-blue-500/15 text-blue-400' : 'bg-white/5 text-neu-muted'
      }`}>
        {subtask.date}
      </span>
      <button onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 transition-opacity"
        title="Delete subtask">
        <X size={14} />
      </button>
    </div>
  )
}

// ─── Add Subtask Inline ──────────────────────────────────────────
function AddSubtaskInput({ onAdd }) {
  const [text, setText] = useState('')
  const handleSubmit = (e) => {
    e.preventDefault()
    if (!text.trim()) return
    onAdd(text.trim())
    setText('')
  }
  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mt-1">
      <input type="text" value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Add a subtask..."
        className="flex-1 bg-transparent text-sm text-neu-text placeholder-neu-muted outline-none neu-pressed-sm px-3 py-2" />
      <button type="submit" className="text-green-400 hover:text-green-300 transition-colors px-2" title="Add subtask">
        <Plus size={16} />
      </button>
    </form>
  )
}

// ─── Task Card ───────────────────────────────────────────────────
function TaskCard({ task, index, onToggleSubtask, onDeleteSubtask, onAddSubtask, onDeleteTask, onReorderSubtasks, onTaskDragStart, onTaskDragOver, onTaskDrop }) {
  const completedCount = task.subtasks.filter((s) => s.done).length
  const total = task.subtasks.length
  const computedProgress = total > 0 ? Math.round((completedCount / total) * 100) : 0
  const allDone = total > 0 && completedCount === total

  const dragItem = useRef(null)
  const dragOver = useRef(null)

  const handleSubDragStart = (e, idx) => { dragItem.current = idx; e.dataTransfer.effectAllowed = 'move'; e.stopPropagation() }
  const handleSubDragOver = (e, idx) => { e.preventDefault(); dragOver.current = idx; e.stopPropagation() }
  const handleSubDrop = (e, idx) => {
    e.preventDefault(); e.stopPropagation()
    if (dragItem.current === null || dragOver.current === null) return
    if (dragItem.current !== dragOver.current) onReorderSubtasks(task.id, dragItem.current, dragOver.current)
    dragItem.current = null; dragOver.current = null
  }

  return (
    <div draggable
      onDragStart={(e) => onTaskDragStart(e, index)}
      onDragOver={(e) => onTaskDragOver(e, index)}
      onDrop={(e) => onTaskDrop(e, index)}
      className="card-animate neu-raised neu-card-hover p-5 flex flex-col gap-4 cursor-grab active:cursor-grabbing"
      style={{ animationDelay: `${index * 60}ms` }}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-neu-muted/40"><GripVertical size={16} /></span>
          <span className="text-lg font-semibold text-neu-text">{index + 1}. {task.title}</span>
        </div>
        <button onClick={() => onDeleteTask(task.id)}
          className="text-neu-muted hover:text-red-400 transition-colors" title="Delete task">
          <Trash2 size={16} />
        </button>
      </div>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium px-3 py-1 rounded-full ${
          allDone ? 'bg-green-500/15 text-green-400'
          : computedProgress > 0 ? 'bg-amber-500/10 text-amber-400'
          : 'bg-white/5 text-neu-muted'
        }`}>
          {allDone ? 'Completed' : computedProgress > 0 ? `Progress ${computedProgress}%` : 'Not started'}
        </span>
        <span className="text-xs text-neu-muted">{completedCount}/{total} done</span>
      </div>
      <div className="progress-bar">
        <div className="progress-bar-fill" style={{ width: `${computedProgress}%` }} />
      </div>
      <div className="flex flex-col gap-2.5 mt-1">
        {task.subtasks.map((subtask, idx) => (
          <Subtask key={subtask.id} subtask={subtask} index={idx}
            onToggle={() => onToggleSubtask(task.id, subtask.id)}
            onDelete={() => onDeleteSubtask(task.id, subtask.id)}
            onDragStart={handleSubDragStart} onDragOver={handleSubDragOver} onDrop={handleSubDrop} />
        ))}
        <AddSubtaskInput onAdd={(text) => onAddSubtask(task.id, text)} />
      </div>
    </div>
  )
}

// ─── History Card ────────────────────────────────────────────────
function HistoryCard({ task, onRestore, onPermanentDelete }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="card-animate neu-raised p-4 flex flex-col gap-3 opacity-75">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => setExpanded(!expanded)}>
          <div className="neu-checkbox checked w-5 h-5">
            <Check size={12} strokeWidth={3} className="text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-neu-muted line-through">{task.title}</span>
            <span className="text-[10px] text-neu-muted/50">{task.completedAt}</span>
          </div>
          {expanded ? <ChevronUp size={14} className="text-neu-muted" /> : <ChevronDown size={14} className="text-neu-muted" />}
        </div>
        <div className="flex gap-2">
          <button onClick={() => onRestore(task.id)} className="text-xs text-green-400/70 hover:text-green-400 transition-colors" title="Restore">Restore</button>
          <button onClick={() => onPermanentDelete(task.id)} className="text-neu-muted hover:text-red-400 transition-colors" title="Delete permanently"><Trash2 size={14} /></button>
        </div>
      </div>
      {expanded && (
        <div className="flex flex-col gap-1.5 pl-8">
          {task.subtasks.map((st) => (
            <span key={st.id} className="text-xs text-neu-muted line-through">{st.text}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Create Task Modal ───────────────────────────────────────────
function CreateTaskModal({ onClose, onCreate }) {
  const [title, setTitle] = useState('')
  const handleSubmit = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    onCreate(title.trim())
    onClose()
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-animate" style={{ backgroundColor: 'rgba(10, 10, 14, 0.8)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div className="modal-animate neu-raised p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-neu-text">New Task</h2>
          <button onClick={onClose} className="text-neu-muted hover:text-neu-text transition-colors"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Task name..." autoFocus
            className="bg-transparent text-neu-text placeholder-neu-muted outline-none neu-pressed px-4 py-3 text-sm" />
          <button type="submit"
            className="w-full py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium text-sm hover:from-green-400 hover:to-emerald-500 transition-all glow-green">
            Create Task
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Stat Card ──────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, delay = 0 }) {
  return (
    <div className="stat-animate neu-raised-sm px-4 py-3 flex items-center gap-3" style={{ animationDelay: `${delay}ms` }}>
      <div className="w-9 h-9 rounded-xl bg-neu-bg flex items-center justify-center"
           style={{ boxShadow: 'inset 2px 2px 5px #111213, inset -2px -2px 5px #252629' }}>
        <Icon size={16} className="text-neu-accent" />
      </div>
      <div>
        <p className="text-xl font-bold text-neu-text">{value}</p>
        <p className="text-[10px] uppercase tracking-widest text-neu-muted font-medium">{label}</p>
      </div>
    </div>
  )
}

// ─── Setup Modal ────────────────────────────────────────────────
function SetupModal({ onClose, onSave }) {
  const settings = loadTaskSettings()
  const [sheetUrl, setSheetUrl] = useState(settings.sheetUrl || '')
  const [webAppUrl, setWebAppUrl] = useState(settings.webAppUrl || '')
  const [apiKey, setApiKey] = useState(settings.apiKey || '')
  const [step, setStep] = useState(1)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!apiKey) setApiKey(generateApiKey())
  }, [])

  const sheetId = extractSheetIdFromUrl(sheetUrl)
  const script = generateTasksAppsScript(sheetId, apiKey)

  const handleCopy = () => {
    navigator.clipboard.writeText(script)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSave = () => {
    const s = { sheetUrl, webAppUrl, apiKey }
    saveTaskSettings(s)
    onSave(s)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-animate" style={{ backgroundColor: 'rgba(10, 10, 14, 0.85)', backdropFilter: 'blur(10px)' }} onClick={onClose}>
      <div className="modal-animate neu-raised p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-neu-accent" />
            <h2 className="text-lg font-semibold text-neu-text">Google Sheets Sync</h2>
          </div>
          <button onClick={onClose} className="text-neu-muted hover:text-neu-text transition-colors"><X size={18} /></button>
        </div>

        {/* Steps */}
        <div className="flex gap-2 mb-5">
          {[1,2,3,4].map(s => (
            <button key={s} onClick={() => setStep(s)}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all ${step === s ? 'bg-neu-accent/20 text-neu-accent' : 'text-neu-muted hover:text-neu-text'}`}>
              Step {s}
            </button>
          ))}
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-neu-muted">Create a Google Spreadsheet for task data and paste its URL below.</p>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-neu-muted font-medium mb-1 block">Google Spreadsheet URL</label>
              <input value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..."
                className="w-full bg-transparent text-sm text-neu-text placeholder-neu-muted outline-none neu-pressed px-4 py-3" />
            </div>
            <button onClick={() => setStep(2)} disabled={!sheetUrl.trim()}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium text-sm disabled:opacity-40 transition-all">
              Next
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-neu-muted">Your API key (auto-generated). Keep this secure.</p>
            <div className="flex gap-2">
              <input value={apiKey} readOnly className="flex-1 bg-transparent text-xs font-mono text-neu-text outline-none neu-pressed px-3 py-2.5" />
              <button onClick={() => setApiKey(generateApiKey())} className="neu-raised-sm px-3 py-2 text-xs text-neu-muted hover:text-neu-accent transition-colors" title="Regenerate">
                <RefreshCw size={13} />
              </button>
            </div>
            <button onClick={() => setStep(3)} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium text-sm transition-all">Next</button>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-neu-muted">Copy this script → Open your Google Sheet → Extensions → Apps Script → paste & save → Deploy → Web app (Execute as: Me, Access: Anyone).</p>
            <div className="relative">
              <pre className="neu-pressed p-3 text-[10px] font-mono text-neu-muted leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                {script.substring(0, 800)}...
              </pre>
              <button onClick={handleCopy}
                className="absolute top-2 right-2 neu-raised-sm px-2.5 py-1.5 text-[10px] font-medium flex items-center gap-1 transition-colors">
                {copied ? <><Check size={10} className="text-green-400" /> Copied</> : <><Copy size={10} className="text-neu-muted" /> Copy Script</>}
              </button>
            </div>
            <button onClick={() => setStep(4)} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium text-sm transition-all">Next</button>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-neu-muted">Paste the Web App URL from the deployment dialog.</p>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-neu-muted font-medium mb-1 block">Web App URL</label>
              <input value={webAppUrl} onChange={e => setWebAppUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec"
                className="w-full bg-transparent text-sm text-neu-text placeholder-neu-muted outline-none neu-pressed px-4 py-3" />
            </div>
            <button onClick={handleSave} disabled={!webAppUrl.trim()}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium text-sm disabled:opacity-40 glow-green transition-all">
              Save & Connect
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Data Menu ──────────────────────────────────────────────────
function DataMenu({ state, setState, onOpenSetup }) {
  const [open, setOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState(null) // 'success' | 'error'
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const settings = loadTaskSettings()
  const isConnected = !!settings.webAppUrl

  const handlePush = async () => {
    if (!settings.webAppUrl) return
    setSyncing(true)
    try {
      await pushTasks(settings.webAppUrl, state.tasks, state.history)
      setSyncStatus('success')
    } catch (err) {
      console.error('Push failed:', err)
      setSyncStatus('error')
    }
    setSyncing(false)
    setTimeout(() => setSyncStatus(null), 3000)
  }

  const handlePull = async () => {
    if (!settings.webAppUrl) return
    setSyncing(true)
    try {
      const data = await pullTasks(settings.webAppUrl)
      if (data.tasks) {
        setState({ tasks: data.tasks, history: data.history || [] })
      }
      setSyncStatus('success')
    } catch (err) {
      console.error('Pull failed:', err)
      setSyncStatus('error')
    }
    setSyncing(false)
    setTimeout(() => setSyncStatus(null), 3000)
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className="neu-raised-sm flex items-center gap-2 px-3 py-2 text-xs font-medium text-neu-muted hover:text-neu-accent transition-all">
        <Settings size={14} />
        Data
        {isConnected && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
        {syncStatus === 'success' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping" />}
        {syncStatus === 'error' && <span className="w-1.5 h-1.5 rounded-full bg-red-400" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 modal-animate neu-raised p-2 min-w-[200px]">
          {isConnected ? (
            <>
              <button onClick={handlePush} disabled={syncing}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-neu-text hover:bg-neu-light transition-colors disabled:opacity-50">
                {syncing ? <RefreshCw size={13} className="animate-spin" /> : <Cloud size={13} />}
                Push to Sheets
              </button>
              <button onClick={handlePull} disabled={syncing}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-neu-text hover:bg-neu-light transition-colors disabled:opacity-50">
                {syncing ? <RefreshCw size={13} className="animate-spin" /> : <Cloud size={13} />}
                Pull from Sheets
              </button>
              <hr className="border-neu-light my-1" />
            </>
          ) : (
            <p className="px-3 py-2 text-[10px] text-neu-muted">Not connected to Google Sheets</p>
          )}
          <button onClick={() => { setOpen(false); onOpenSetup() }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-neu-text hover:bg-neu-light transition-colors">
            <Settings size={13} /> {isConnected ? 'Settings' : 'Setup Sync'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main App ────────────────────────────────────────────────────
export default function App() {
  const [state, setState] = useState(getInitialState)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [view, setView] = useState('dashboard')

  const { tasks, history } = state

  // Persist on every change
  useEffect(() => { saveData(state) }, [state])

  // Auto-sync to Google Sheets when data changes (debounced)
  const syncTimer = useRef(null)
  useEffect(() => {
    const settings = loadTaskSettings()
    if (!settings.webAppUrl) return
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(async () => {
      try {
        await pushTasks(settings.webAppUrl, state.tasks, state.history)
      } catch {}
    }, 5000)
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current) }
  }, [state])

  // Auto-move fully completed tasks to history after a short delay
  useEffect(() => {
    const completed = tasks.filter((t) => t.subtasks.length > 0 && t.subtasks.every((s) => s.done))
    if (completed.length === 0) return
    const timeout = setTimeout(() => {
      setState((prev) => {
        const now = formatNow()
        const completedIds = completed.map((c) => c.id)
        return {
          tasks: prev.tasks.filter((t) => !completedIds.includes(t.id)),
          history: [...completed.map((t) => ({ ...t, completedAt: now })), ...prev.history],
        }
      })
    }, 1500)
    return () => clearTimeout(timeout)
  }, [tasks])

  // ── Task drag & drop ─────────────────────────────
  const taskDragItem = useRef(null)
  const taskDragOver = useRef(null)
  const handleTaskDragStart = (e, idx) => { taskDragItem.current = idx; e.dataTransfer.effectAllowed = 'move' }
  const handleTaskDragOver = (e, idx) => { e.preventDefault(); taskDragOver.current = idx }
  const handleTaskDrop = (e) => {
    e.preventDefault()
    if (taskDragItem.current === null || taskDragOver.current === null) return
    if (taskDragItem.current !== taskDragOver.current) {
      setState((prev) => ({ ...prev, tasks: reorder(prev.tasks, taskDragItem.current, taskDragOver.current) }))
    }
    taskDragItem.current = null; taskDragOver.current = null
  }

  // ── Callbacks ────────────────────────────────────
  const toggleSubtask = useCallback((taskId, subtaskId) => {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        task.id === taskId ? { ...task, subtasks: task.subtasks.map((st) => st.id === subtaskId ? { ...st, done: !st.done } : st) } : task
      ),
    }))
  }, [])

  const deleteSubtask = useCallback((taskId, subtaskId) => {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        task.id === taskId ? { ...task, subtasks: task.subtasks.filter((st) => st.id !== subtaskId) } : task
      ),
    }))
  }, [])

  const addSubtask = useCallback((taskId, text) => {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        task.id === taskId ? { ...task, subtasks: [...task.subtasks, { id: uid(), text, date: formatDate(), done: false }] } : task
      ),
    }))
  }, [])

  const reorderSubtasks = useCallback((taskId, fromIdx, toIdx) => {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        task.id === taskId ? { ...task, subtasks: reorder(task.subtasks, fromIdx, toIdx) } : task
      ),
    }))
  }, [])

  const deleteTask = useCallback((taskId) => {
    setState((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== taskId) }))
  }, [])

  const createTask = useCallback((title) => {
    setState((prev) => ({ ...prev, tasks: [...prev.tasks, { id: uid(), title, subtasks: [] }] }))
  }, [])

  const restoreTask = useCallback((taskId) => {
    setState((prev) => {
      const task = prev.history.find((t) => t.id === taskId)
      if (!task) return prev
      const { completedAt, ...restored } = task
      return {
        tasks: [...prev.tasks, { ...restored, subtasks: restored.subtasks.map((s) => ({ ...s, done: false })) }],
        history: prev.history.filter((t) => t.id !== taskId),
      }
    })
  }, [])

  const permanentDelete = useCallback((taskId) => {
    setState((prev) => ({ ...prev, history: prev.history.filter((t) => t.id !== taskId) }))
  }, [])

  // Computed stats
  const totalSubtasks = tasks.reduce((a, t) => a + t.subtasks.length, 0)
  const doneSubtasks = tasks.reduce((a, t) => a + t.subtasks.filter((s) => s.done).length, 0)
  const inProgressTasks = tasks.filter(t => t.subtasks.length > 0 && t.subtasks.some(s => s.done) && !t.subtasks.every(s => s.done)).length

  const filteredTasks = searchQuery.trim()
    ? tasks.filter((t) => t.title.toLowerCase().includes(searchQuery.toLowerCase()) || t.subtasks.some((s) => s.text.toLowerCase().includes(searchQuery.toLowerCase())))
    : tasks

  const filteredHistory = searchQuery.trim()
    ? history.filter((t) => t.title.toLowerCase().includes(searchQuery.toLowerCase()) || t.subtasks.some((s) => s.text.toLowerCase().includes(searchQuery.toLowerCase())))
    : history

  const isConnected = !!loadTaskSettings().webAppUrl

  return (
    <div className="min-h-screen bg-neu-bg">
      <div className="max-w-7xl mx-auto px-4 py-8 md:px-8 lg:px-12">

        {/* ── Header ── */}
        <header className="header-animate mb-8">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-xl bg-neu-surface flex items-center justify-center"
                     style={{ boxShadow: '3px 3px 8px #111213, -3px -3px 8px #2e3035' }}>
                  <ClipboardList size={20} className="text-neu-accent" />
                </div>
                <h1 className="text-2xl md:text-3xl font-extrabold text-neu-text tracking-tight">
                  Task <span className="text-neu-accent">Tracker</span>
                </h1>
                <a href={`${import.meta.env.BASE_URL}patch-tracker.html`}
                  className="neu-raised-sm flex items-center gap-2 px-3 py-2 text-xs font-medium text-neu-muted hover:text-green-400 transition-all hover:shadow-lg ml-2">
                  <Bandage size={14} /> Patch Tracker
                </a>
              </div>
              <p className="text-xs text-neu-muted mt-1 ml-1">Manage tasks and track progress across your team</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap self-start md:self-auto">
              <DataMenu state={state} setState={setState} onOpenSetup={() => setShowSetup(true)} />
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-semibold text-sm hover:from-green-400 hover:to-emerald-500 transition-all glow-green">
                <Plus size={16} strokeWidth={2.5} /> New Task
              </button>
            </div>
          </div>

          {/* ── Stats ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard icon={ClipboardList} label="Total" value={tasks.length} delay={100} />
            <StatCard icon={Clock} label="In Progress" value={inProgressTasks} delay={200} />
            <StatCard icon={CheckCircle2} label="Completed" value={doneSubtasks + '/' + totalSubtasks} delay={300} />
            <StatCard icon={Archive} label="History" value={history.length} delay={400} />
          </div>

          {/* ── Toolbar ── */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="neu-pressed-sm flex p-1 gap-1">
              <button onClick={() => setView('dashboard')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  view === 'dashboard' ? 'bg-neu-light text-green-400 shadow-md' : 'text-neu-muted hover:text-neu-text'
                }`}>
                <LayoutDashboard size={14} /> Tasks
              </button>
              <button onClick={() => setView('history')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  view === 'history' ? 'bg-neu-light text-green-400 shadow-md' : 'text-neu-muted hover:text-neu-text'
                }`}>
                <History size={14} /> History
              </button>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-neu-muted whitespace-nowrap">
                <span className="text-green-400 font-semibold">{doneSubtasks}</span>
                <span>/{totalSubtasks}</span> Done
              </span>
              <div className="neu-pressed flex items-center gap-2 px-4 py-2.5 w-52">
                <Search size={14} className="text-neu-muted flex-shrink-0" />
                <input type="text" placeholder="Search..." value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent outline-none text-sm text-neu-text placeholder-neu-muted w-full" />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="text-neu-muted hover:text-neu-text"><X size={12} /></button>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* ── Dashboard View ── */}
        {view === 'dashboard' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredTasks.map((task, i) => (
                <TaskCard key={task.id} task={task} index={i}
                  onToggleSubtask={toggleSubtask} onDeleteSubtask={deleteSubtask}
                  onAddSubtask={addSubtask} onDeleteTask={deleteTask}
                  onReorderSubtasks={reorderSubtasks}
                  onTaskDragStart={handleTaskDragStart} onTaskDragOver={handleTaskDragOver} onTaskDrop={handleTaskDrop} />
              ))}
            </div>
            {filteredTasks.length === 0 && (
              <div className="flex flex-col items-center justify-center mt-20 text-neu-muted">
                <LayoutDashboard size={48} strokeWidth={1} className="mb-4 opacity-30" />
                <p className="text-lg">{searchQuery ? 'No tasks match your search' : 'No active tasks'}</p>
                {!searchQuery && (
                  <button onClick={() => setShowCreate(true)} className="mt-4 text-sm text-green-400 hover:text-green-300 transition-colors">
                    Create your first task
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* ── History View ── */}
        {view === 'history' && (
          <>
            {filteredHistory.length > 0 && (
              <p className="text-xs text-neu-muted mb-4">{filteredHistory.length} completed task{filteredHistory.length !== 1 ? 's' : ''}</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredHistory.map((task, i) => (
                <HistoryCard key={task.id} task={task} onRestore={restoreTask} onPermanentDelete={permanentDelete} />
              ))}
            </div>
            {filteredHistory.length === 0 && (
              <div className="flex flex-col items-center justify-center mt-20 text-neu-muted">
                <History size={48} strokeWidth={1} className="mb-4 opacity-30" />
                <p className="text-lg">{searchQuery ? 'No history matches your search' : 'No completed tasks yet'}</p>
              </div>
            )}
          </>
        )}

        {/* ── Modals ── */}
        {showCreate && <CreateTaskModal onClose={() => setShowCreate(false)} onCreate={createTask} />}
        {showSetup && <SetupModal onClose={() => setShowSetup(false)} onSave={() => {}} />}

        {/* ── Sync status footer ── */}
        {isConnected && (
          <div className="fixed bottom-4 right-4 text-[10px] text-neu-muted/50 flex items-center gap-1">
            <Cloud size={10} /> Synced to Google Sheets
          </div>
        )}
      </div>
    </div>
  )
}
